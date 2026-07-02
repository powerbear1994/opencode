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

  test("parses minimax tool calls with unquoted edit parameters", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-minimax-edit" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              [
                'data: {"content":"<minimax:tool_call>',
                '<invoke name=edit>',
                '<parameter name=filePath>src/App.vue</parameter>',
                '<parameter name=oldString>old content</parameter>',
                '<parameter name=newString>new content</parameter>',
                "</invoke>",
                '</minimax:tool_call>"}',
              ].join(""),
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(provider(server.url.origin, { adapter: "minimax" }))(
        "http://company-txt.local/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-coder",
            messages: [{ role: "user", content: "edit the file" }],
            tools: [{ type: "function", function: { name: "edit", parameters: { type: "object" } } }],
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
      expect(body.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("edit")
      expect(JSON.parse(body.choices[0]?.message.tool_calls?.[0]?.function.arguments ?? "{}")).toEqual({
        filePath: "src/App.vue",
        oldString: "old content",
        newString: "new content",
      })
    } finally {
      await server.stop(true)
    }
  })

  test("uses full message events as final output without duplicating streamed chunks", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-message" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"hello"}',
              "",
              "event: message",
              'data: {"content":"hello"}',
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
            messages: [{ role: "user", content: "say hello" }],
          }),
        },
      )
      const events = sseEvents(await response.text())

      expect(events.filter((event) => event.choices?.[0]?.delta?.content === "hello")).toHaveLength(1)
      expect(events.some((event) => event.choices?.[0]?.delta?.content === "hellohello")).toBe(false)
    } finally {
      await server.stop(true)
    }
  })

  test("renders tool responses with the previous tool call name", async () => {
    let prompt = ""
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-tool-result" } })
        }
        if (url.pathname === "/chatabc/chat") {
          const payload = (await request.json()) as { data?: { txt?: string } }
          prompt = payload.data?.txt ?? ""
          return new Response(["event: chunk", 'data: {"content":"done"}', ""].join("\n"), {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      await createCompanyTxtFetch(provider(server.url.origin))("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          messages: [
            { role: "user", content: "find files" },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_glob",
                  type: "function",
                  function: { name: "glob", arguments: '{"pattern":"**/*.ts"}' },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_glob", content: "src/app.ts" },
          ],
        }),
      })

      expect(prompt).toContain("tool_response name=glob id=call_glob:")
      expect(prompt).not.toContain("tool_response name=call_glob id=call_glob:")
    } finally {
      await server.stop(true)
    }
  })

  test("renders previous qwen tool calls as native parameters", async () => {
    let prompt = ""
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-native-args" } })
        }
        if (url.pathname === "/chatabc/chat") {
          const payload = (await request.json()) as { data?: { txt?: string } }
          prompt = payload.data?.txt ?? ""
          return new Response(["event: chunk", 'data: {"content":"done"}', ""].join("\n"), {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      await createCompanyTxtFetch(provider(server.url.origin))("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          messages: [
            { role: "user", content: "find files" },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_glob",
                  type: "function",
                  function: {
                    name: "glob",
                    arguments: JSON.stringify({ pattern: "**/*.ts", path: "packages/opencode" }),
                  },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_glob", content: "packages/opencode/src/provider/company-txt.ts" },
          ],
        }),
      })

      expect(prompt).toContain("<function=glob>")
      expect(prompt).toContain("<parameter=pattern>\n**/*.ts\n</parameter>")
      expect(prompt).toContain("<parameter=path>\npackages/opencode\n</parameter>")
      expect(prompt).not.toContain("<parameter=arguments>")
      expect(prompt).not.toContain("tool_call:\n<tool_call>")
    } finally {
      await server.stop(true)
    }
  })

  test("prompts kimi models to emit strict JSON tool arguments", async () => {
    let prompt = ""
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-kimi-rules" } })
        }
        if (url.pathname === "/chatabc/chat") {
          const payload = (await request.json()) as { data?: { txt?: string } }
          prompt = payload.data?.txt ?? ""
          return new Response(["event: chunk", 'data: {"content":"done"}', ""].join("\n"), {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      await createCompanyTxtFetch(provider(server.url.origin, { adapter: "kimi" }))(
        "http://company-txt.local/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-coder",
            messages: [{ role: "user", content: "write a Vue file" }],
            tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
          }),
        },
      )

      expect(prompt).toContain("must be one strict JSON object")
      expect(prompt).toContain('escape inner double quotes as \\"')
      expect(prompt).toContain('<script setup lang=\\"ts\\">')
      expect(prompt).toContain("preserve human-readable multi-line formatting")
    } finally {
      await server.stop(true)
    }
  })

  test("renders previous minimax tool call argument values without xml escaping", async () => {
    let prompt = ""
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-minimax-raw" } })
        }
        if (url.pathname === "/chatabc/chat") {
          const payload = (await request.json()) as { data?: { txt?: string } }
          prompt = payload.data?.txt ?? ""
          return new Response(["event: chunk", 'data: {"content":"done"}', ""].join("\n"), {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      await createCompanyTxtFetch(provider(server.url.origin, { adapter: "minimax" }))(
        "http://company-txt.local/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-coder",
            messages: [
              {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_shell",
                    type: "function",
                    function: { name: "shell", arguments: JSON.stringify({ cmd: 'echo "a&b"' }) },
                  },
                ],
              },
            ],
          }),
        },
      )

      expect(prompt).not.toContain("&quot;")
      expect(prompt).not.toContain("&amp;")
      expect(prompt).toContain('<parameter name="cmd">echo "a&b"</parameter>')
    } finally {
      await server.stop(true)
    }
  })

  test("instructs models to repair invalid tool arguments", async () => {
    let prompt = ""
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-invalid-tool" } })
        }
        if (url.pathname === "/chatabc/chat") {
          const payload = (await request.json()) as { data?: { txt?: string } }
          prompt = payload.data?.txt ?? ""
          return new Response(["event: chunk", 'data: {"content":"done"}', ""].join("\n"), {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      await createCompanyTxtFetch(provider(server.url.origin))("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          messages: [
            { role: "user", content: "write the file" },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_invalid",
                  type: "function",
                  function: {
                    name: "invalid",
                    arguments: JSON.stringify({
                      tool: "write",
                      error:
                        'The write tool was called with invalid arguments: SchemaError(Missing key\n at ["content"].)\nPlease rewrite the input so it satisfies the expected schema.',
                    }),
                  },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: "call_invalid",
              content:
                'The arguments provided to the tool are invalid: The write tool was called with invalid arguments: SchemaError(Missing key\n at ["content"].)\nPlease rewrite the input so it satisfies the expected schema.',
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "write",
                parameters: {
                  type: "object",
                  required: ["filePath", "content"],
                  properties: {
                    filePath: { type: "string" },
                    content: { type: "string" },
                  },
                },
              },
            },
          ],
        }),
      })

      expect(prompt).toContain("Include every required property")
      expect(prompt).toContain("A previous tool response reported invalid arguments")
      expect(prompt).toContain("call that original tool again")
      expect(prompt).toContain("tool_response name=invalid id=call_invalid:")
    } finally {
      await server.stop(true)
    }
  })

  test("instructs models to recover from failed tool calls", async () => {
    let prompt = ""
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-failed-tool" } })
        }
        if (url.pathname === "/chatabc/chat") {
          const payload = (await request.json()) as { data?: { txt?: string } }
          prompt = payload.data?.txt ?? ""
          return new Response(["event: chunk", 'data: {"content":"done"}', ""].join("\n"), {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      await createCompanyTxtFetch(provider(server.url.origin))("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          messages: [
            { role: "user", content: "find package files" },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_glob",
                  type: "function",
                  function: {
                    name: "glob",
                    arguments: JSON.stringify({ pattern: "**/package.json", path: "C:\\Users\\codd-vue" }),
                  },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_glob", content: "ripgrep execution failed" },
          ],
          tools: [{ type: "function", function: { name: "glob", parameters: { type: "object" } } }],
        }),
      })

      expect(prompt).toContain("A previous tool response reported a recoverable failure")
      expect(prompt).toContain("retry the same tool with corrected arguments")
      expect(prompt).toContain("tool_response name=glob id=call_glob:")
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

  test("strips echoed tool_call labels before streamed native tool calls", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-tool-label-stream" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"thinking\\ntool_"}',
              "",
              "event: chunk",
              'data: {"content":"call:\\n<tool_call>\\n<function=write>\\n<parameter=path>\\n\\"src/app.ts\\"\\n</parameter>\\n</function>\\n</tool_call>"}',
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
            messages: [{ role: "user", content: "write the file" }],
            tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
          }),
        },
      )
      const events = sseEvents(await response.text())
      const contents = events.flatMap((event) => event.choices?.[0]?.delta?.content ?? [])

      expect(contents.join("")).toBe("thinking")
      expect(contents.join("")).not.toContain("tool_call")
      expect(events.some((event) => event.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name === "write")).toBe(true)
      expect(events.findLast((event) => event.choices?.[0])?.choices?.[0]?.finish_reason).toBe("tool_calls")
    } finally {
      await server.stop(true)
    }
  })

  test("streams qwen tool calls as live OpenAI deltas", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-live-qwen" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"checking <tool_call>\\n<function=write>\\n<parameter=path>src/App"}',
              "",
              "event: chunk",
              'data: {"content":".vue</parameter>\\n<parameter=content>{\\"ok\\":true}</parameter>\\n</function>\\n</tool_call>"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(
        provider(server.url.origin, { stream_tool_call_mode: "live_delta" }),
      )("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          stream: true,
          messages: [{ role: "user", content: "write a file" }],
          tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
        }),
      })
      const events = sseEvents(await response.text())
      const deltas = events.flatMap((event) => event.choices?.[0]?.delta?.tool_calls ?? [])
      const argumentText = deltas.map((delta) => delta.function?.arguments ?? "").join("")

      expect(events.some((event) => event.choices?.[0]?.delta?.content === "checking ")).toBe(true)
      expect(deltas[0]).toMatchObject({ index: 0, type: "function", function: { name: "write", arguments: "" } })
      expect(JSON.parse(argumentText)).toEqual({ path: "src/App.vue", content: { ok: true } })
      expect(events.findLast((event) => event.choices?.[0])?.choices?.[0]?.finish_reason).toBe("tool_calls")
    } finally {
      await server.stop(true)
    }
  })

  test("strips echoed tool_call labels before live OpenAI deltas", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-live-tool-label" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"tool_call:"}',
              "",
              "event: chunk",
              'data: {"content":"\\n<tool_call>\\n<function=write>\\n<parameter=path>src/App"}',
              "",
              "event: chunk",
              'data: {"content":".vue</parameter>\\n</function>\\n</tool_call>"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(
        provider(server.url.origin, { stream_tool_call_mode: "live_delta" }),
      )("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          stream: true,
          messages: [{ role: "user", content: "write a file" }],
          tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
        }),
      })
      const events = sseEvents(await response.text())
      const content = events.map((event) => event.choices?.[0]?.delta?.content ?? "").join("")
      const deltas = events.flatMap((event) => event.choices?.[0]?.delta?.tool_calls ?? [])

      expect(content).toBe("")
      expect(deltas[0]).toMatchObject({ index: 0, type: "function", function: { name: "write", arguments: "" } })
      expect(JSON.parse(deltas.map((delta) => delta.function?.arguments ?? "").join(""))).toEqual({
        path: "src/App.vue",
      })
      expect(events.findLast((event) => event.choices?.[0])?.choices?.[0]?.finish_reason).toBe("tool_calls")
    } finally {
      await server.stop(true)
    }
  })

  test("streams kimi tool calls as live OpenAI deltas", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-live-kimi" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"\\n<|tool_calls_section_begin|>\\n  <|tool_call_begin|> functions.search_code:0 <|tool_call_argument_begin|>{\\"keyword\\":\\"User"}',
              "",
              "event: chunk",
              'data: {"content":"Service\\"}<|tool_call_end|>\\n<|tool_calls_section_end|>"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(
        provider(server.url.origin, { adapter: "kimi", stream_tool_call_mode: "live_delta" }),
      )("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          stream: true,
          messages: [{ role: "user", content: "search" }],
          tools: [{ type: "function", function: { name: "search_code", parameters: { type: "object" } } }],
        }),
      })
      const events = sseEvents(await response.text())
      const deltas = events.flatMap((event) => event.choices?.[0]?.delta?.tool_calls ?? [])

      expect(deltas[0]).toMatchObject({
        index: 0,
        id: "functions.search_code:0",
        type: "function",
        function: { name: "search_code", arguments: "" },
      })
      expect(JSON.parse(deltas.map((delta) => delta.function?.arguments ?? "").join(""))).toEqual({
        keyword: "UserService",
      })
      expect(events.findLast((event) => event.choices?.[0])?.choices?.[0]?.finish_reason).toBe("tool_calls")
    } finally {
      await server.stop(true)
    }
  })

  test("streams minimax tool calls as live OpenAI deltas", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/chatabc/init_session") {
          return Response.json({ resCode: "FAIAG0000", data: { session_id: "session-live-minimax" } })
        }
        if (url.pathname === "/chatabc/chat") {
          return new Response(
            [
              "event: chunk",
              'data: {"content":"<minimax:tool_call><invoke name=\\"edit\\"><parameter name=\\"filePath\\">src/App"}',
              "",
              "event: chunk",
              'data: {"content":".vue</parameter><parameter name=\\"newString\\">hello</parameter></invoke></minimax:tool_call>"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response("not found", { status: 404 })
      },
    })

    try {
      const response = await createCompanyTxtFetch(
        provider(server.url.origin, { adapter: "minimax", stream_tool_call_mode: "live_delta" }),
      )("http://company-txt.local/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-coder",
          stream: true,
          messages: [{ role: "user", content: "edit" }],
          tools: [{ type: "function", function: { name: "edit", parameters: { type: "object" } } }],
        }),
      })
      const events = sseEvents(await response.text())
      const deltas = events.flatMap((event) => event.choices?.[0]?.delta?.tool_calls ?? [])

      expect(deltas[0]).toMatchObject({ index: 0, type: "function", function: { name: "edit", arguments: "" } })
      expect(JSON.parse(deltas.map((delta) => delta.function?.arguments ?? "").join(""))).toEqual({
        filePath: "src/App.vue",
        newString: "hello",
      })
      expect(events.findLast((event) => event.choices?.[0])?.choices?.[0]?.finish_reason).toBe("tool_calls")
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
