import { describe, expect, test } from "bun:test"
import type { Info } from "../../src/provider/provider"
import { createCompanyTxtFetch } from "../../src/provider/company-txt"

describe("company-txt provider", () => {
  test("lists configured models through the OpenAI-compatible models endpoint", async () => {
    const response = await createCompanyTxtFetch(provider("http://company.local"))(
      "http://company-txt.local/v1/models",
      { method: "GET" },
    )
    const body = (await response.json()) as { data: Array<{ id: string }> }

    expect(body.data.map((model) => model.id)).toEqual(["qwen3-coder"])
  })

  test("adapts company txt stream into OpenAI compatible tool calls", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-1" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"<tool_call>\\n<function=write>\\n<parameter=path>\\n\\"src/app.ts\\"\\n</parameter>\\n</function>\\n</tool_call>"}',
              "",
              "event: done",
              "data: {}",
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(provider(server.url.origin))(
        "http://company-txt.local/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-coder",
            messages: [{ role: "user", content: "write the file" }],
            tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
          }),
        },
      )
      const body = (await response.json()) as {
        choices: Array<{
          finish_reason: string
          message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> }
        }>
      }

      expect(body.choices[0]?.finish_reason).toBe("tool_calls")
      expect(body.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("write")
      expect(JSON.parse(body.choices[0]?.message.tool_calls?.[0]?.function.arguments ?? "{}")).toEqual({
        path: "src/app.ts",
      })
    } finally {
      await server.stop(true)
    }
  })

  test("honors parallel_tool_calls false", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-parallel" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"<tool_call>\\n<function=write>\\n<parameter=path>\\n\\"a.ts\\"\\n</parameter>\\n</function>\\n</tool_call><tool_call>\\n<function=write>\\n<parameter=path>\\n\\"b.ts\\"\\n</parameter>\\n</function>\\n</tool_call>"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(provider(server.url.origin))(
        "http://company-txt.local/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-coder",
            parallel_tool_calls: false,
            messages: [{ role: "user", content: "write two files" }],
            tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
          }),
        },
      )
      const body = (await response.json()) as {
        choices: Array<{ message: { tool_calls?: unknown[] } }>
      }

      expect(body.choices[0]?.message.tool_calls).toHaveLength(1)
    } finally {
      await server.stop(true)
    }
  })

  test("streams content before buffering native tool calls", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-3" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"hello <tool_call>"}',
              "",
              "event: chunk",
              'data: {"content":"\\n<function=write>\\n<parameter=path>\\n\\"src/app.ts\\"\\n</parameter>\\n</function>\\n</tool_call>"}',
              "",
              "event: done",
              "data: {}",
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(provider(server.url.origin))(
        "http://company-txt.local/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-coder",
            stream: true,
            stream_options: { include_usage: true },
            messages: [{ role: "user", content: "stream then tool" }],
            tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
          }),
        },
      )
      const events = sseEvents(await response.text())

      expect(events[0]?.choices?.[0]?.delta?.role).toBe("assistant")
      expect(events.some((event) => event.choices?.[0]?.delta?.content === "hello ")).toBe(true)
      expect(events.some((event) => event.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name === "write")).toBe(true)
      expect(events.some((event) => event.choices?.length === 0 && event.usage)).toBe(true)
    } finally {
      await server.stop(true)
    }
  })

  test("uploads images, forwards metadata variables, applies stop sequences, and reports prompt usage", async () => {
    const seen = {
      init: undefined as unknown,
      chat: undefined as unknown,
      uploads: 0,
    }
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          seen.init = await request.json()
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-2" } })
        }
        if (url.pathname === "/chatabc/upload_file") {
          seen.uploads++
          const form = await request.formData()
          expect(form.get("session_id")).toBe("session-2")
          expect(form.get("file")).toBeInstanceOf(Blob)
          return Response.json({ resCode: "FAIAG0000" })
        }
        if (url.pathname === "/chatabc/chat") {
          seen.chat = await request.json()
          return new Response(
            ["event: chunk", 'data: {"content":"hello STOP hidden"}', "", "event: done", "data: {}", ""].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(
        provider(server.url.origin, {
          native_stop_sequences: ["STOP"],
          image_token_budget: { mode: "fixed", tokens_per_image: 7 },
        }),
      )("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          metadata: { prompt_variables: [{ name: "tenant", value: "demo" }] },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "return a greeting" },
                { type: "image_url", image_url: { url: pngDataURL() } },
              ],
            },
          ],
        }),
      })
      const body = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
      }

      expect(body.choices[0]?.message.content).toBe("hello ")
      expect(body.usage.prompt_tokens).toBeGreaterThan(7)
      expect(body.usage.total_tokens).toBeGreaterThan(body.usage.completion_tokens)
      expect(seen.uploads).toBe(1)
      expect(seen.init).toMatchObject({
        data: { prompt_variables: [{ name: "tenant", value: "demo" }] },
      })
      expect(seen.chat).toMatchObject({
        data: {
          session_id: "session-2",
          files: [{ file_id: "image_1", url: "image_1.png", content_type: "image" }],
        },
      })
    } finally {
      await server.stop(true)
    }
  })

  test("returns OpenAI-compatible invalid request errors", async () => {
    const response = await createCompanyTxtFetch(provider("http://company.local", { use_type: "bad" }))(
      "http://company-txt.local/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "qwen3-coder", messages: [{ role: "user", content: "hello" }] }),
      },
    )
    const body = (await response.json()) as { error: { code: string; param: string | null } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("invalid_provider_config")
    expect(body.error.param).toBeNull()
  })
})

function provider(agentURL: string, modelOptions: Record<string, unknown> = {}) {
  return {
    id: "company-txt",
    source: "config",
    name: "Company TXT",
    env: [],
    key: undefined,
    options: {},
    models: {
      "qwen3-coder": {
        id: "qwen3-coder",
        providerID: "company-txt",
        name: "Qwen3 Coder",
        family: "qwen",
        api: { id: "qwen3-coder", npm: "@ai-sdk/openai-compatible", url: "" },
        status: "active",
        headers: {},
        options: { adapter: "qwen", agent_urls: [agentURL], ...modelOptions },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 262_144, output: 0 },
        capabilities: {
          temperature: false,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        release_date: "",
        variants: {},
      },
    },
  } as unknown as Info
}

function pngDataURL() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzY2QAAAABJRU5ErkJggg=="
}

function sseEvents(text: string) {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: ") && block !== "data: [DONE]")
    .map((block) => JSON.parse(block.replace(/^data: /, "")))
}
