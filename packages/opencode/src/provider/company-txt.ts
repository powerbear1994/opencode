import fs from "node:fs/promises"
import path from "node:path"
import type { Info, Model } from "./provider"
import { countCompanyTxtTokens } from "./company-txt-tokenizer"

type ChatRequest = {
  model?: string
  messages?: ChatMessage[]
  tools?: unknown[]
  tool_choice?: unknown
  response_format?: Record<string, unknown>
  max_tokens?: number
  stop?: string | string[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  parallel_tool_calls?: boolean
  metadata?: Record<string, unknown>
}

type ChatMessage = {
  role?: string
  content?: unknown
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

type ToolCall = {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

type ParsedOutput =
  | { type: "final"; content: string }
  | { type: "tool_calls"; content?: string; toolCalls: OpenAIToolCall[] }

type OpenAIToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

type CompanyStreamEvent = {
  event: string
  data: Record<string, unknown>
}

type CompanyTxtRawLogger = {
  log: (record: Record<string, unknown>) => Promise<void>
}

type CompanyTxtFetchOptions = {
  logRoot?: string
}

type ImageUpload = {
  filename: string
  content: Uint8Array
  contentType: string
}

type RequestMetadata = Record<string, unknown> & {
  image_uploads?: ImageUpload[]
}

type ContextBudget = {
  promptTokens: number
  completionTokens: number
}

type StreamTranslationState = {
  sentContent: string
  pending: string
  bufferingTool: boolean
  messageContent?: string
}

type StopState = {
  stop: string[]
  pending: string
  stopped: boolean
  keepLength: number
}

const TOOL_MARKERS = ["<tool_call>", "<|tool_calls_section_begin|>", "<minimax:tool_call>"]
const MAX_TOOL_MARKER_LENGTH = Math.max(...TOOL_MARKERS.map((marker) => marker.length))

class CompanyTxtRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly param?: string

  constructor(message: string, options: { status?: number; code?: string; param?: string } = {}) {
    super(message)
    this.name = "CompanyTxtRequestError"
    this.status = options.status ?? 400
    this.code = options.code ?? "invalid_request"
    this.param = options.param
  }
}

export function createCompanyTxtFetch(
  provider: Info,
  options: CompanyTxtFetchOptions = {},
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    if (isModels(input)) return jsonResponse(modelList(provider))
    if (!isChatCompletions(input)) return fetch(input, init)

    try {
      const request = await readChatRequest(init?.body)
      const model = requireModel(provider, request.model)
      const config = model.options ?? {}
      const baseURL = selectBaseURL(model)
      const use = useType(config)
      const txtField = stringOption(provider.options.txtField) ?? stringOption(provider.options.txt_field) ?? "txt"
      const metadata = await buildRequestMetadata(request, provider, model)
      const prompt = renderPrompt(request, config)
      const budget = await validatePrompt(prompt, request, model, metadata)
      const sessionID = await initSession(baseURL, use, metadata)
      await uploadFiles(baseURL, sessionID, metadata)
      const rawLogger = createCompanyTxtRawLogger(request, model, metadata, sessionID, options)
      const upstream = await fetch(`${baseURL}/chatabc/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: init?.signal,
        body: JSON.stringify({
          appId: "1",
          trCode: "1",
          trVersion: "",
          timestamp: Date.now(),
          requestId: id("req"),
          data: {
            session_id: sessionID,
            [txtField]: prompt,
            files: buildChatFiles(use, metadata),
            stream: "true",
          },
        }),
      })

      if (!upstream.ok || !upstream.body) {
        return errorResponse(`Company model API call failed: ${upstream.status}`, "upstream_error", 502)
      }
      await rawLogger.log({ type: "request", baseURL, use_type: use, txt_field: txtField })
      if (request.stream) return streamResponse(upstream.body, request, model, budget, rawLogger)
      return jsonResponse(await collectCompletion(upstream.body, request, model, budget, rawLogger))
    } catch (error) {
      if (error instanceof CompanyTxtRequestError) {
        return errorResponse(error.message, error.code, error.status, error.param)
      }
      return errorResponse(
        error instanceof Error ? error.message : "Company TXT provider failed",
        "provider_error",
        500,
      )
    }
  }
}

function isModels(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  return url.endsWith("/models")
}

function isChatCompletions(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  return url.endsWith("/chat/completions")
}

function modelList(provider: Info) {
  return {
    object: "list",
    data: Object.values(provider.models).map((model) => ({
      id: model.api.id || model.id,
      object: "model",
      created: 0,
      owned_by: "company-txt",
    })),
  }
}

async function readChatRequest(body: BodyInit | null | undefined): Promise<ChatRequest> {
  if (typeof body === "string") return JSON.parse(body) as ChatRequest
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body)) as ChatRequest
  if (body instanceof Blob) return JSON.parse(await body.text()) as ChatRequest
  throw new Error("company-txt provider expected a JSON chat/completions body")
}

function requireModel(provider: Info, modelID: string | undefined) {
  if (!modelID) throw new CompanyTxtRequestError("company-txt request is missing model", { param: "model" })
  const model = provider.models[modelID]
  if (!model)
    throw new CompanyTxtRequestError(`company-txt model is not configured: ${modelID}`, {
      code: "model_not_found",
      param: "model",
    })
  return model
}

function selectBaseURL(model: Model) {
  const raw = model.options.agentUrls ?? model.options.agent_urls
  const urls = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  const normalized = urls.map((item) => String(item).trim().replace(/\/+$/, "")).filter(Boolean)
  if (normalized.length === 0)
    throw new CompanyTxtRequestError(`company-txt model ${model.id} is missing agent_urls`, {
      code: "invalid_provider_config",
    })
  if (normalized.length === 1) return normalized[0]!
  return normalized[Math.floor(Math.random() * normalized.length)]!
}

function useType(config: Record<string, unknown>) {
  const value = (stringOption(config.useType) ?? stringOption(config.use_type) ?? "agent").toLowerCase()
  if (value === "agent" || value === "workflow") return value
  throw new CompanyTxtRequestError("company-txt use_type must be one of: agent, workflow", {
    code: "invalid_provider_config",
  })
}

async function initSession(baseURL: string, useType: string, metadata: RequestMetadata) {
  const response = await fetch(`${baseURL}/chatabc/init_session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      useType === "workflow"
        ? {
            appId: "1",
            trCode: "1",
            trVersion: "1",
            agent_id: "",
            requestId: "1",
            timestamp: 1,
            data: {
              config_variables: [
                ...arrayOption(metadata.config_variables),
                ...imageUploads(metadata).map((upload) => ({ name: "img", value: upload.filename })),
              ],
            },
          }
        : {
            appId: "1",
            trCode: "1",
            trVersion: "",
            timestamp: 1,
            agent_id: "1",
            requestId: id("req"),
            data: { prompt_variables: arrayOption(metadata.prompt_variables) },
          },
    ),
  })
  if (!response.ok) throw new Error(`company-txt init_session failed: ${response.status}`)
  const json = (await response.json()) as { resCode?: string; resMessage?: string; data?: { session_id?: string } }
  if (json.resCode !== undefined && json.resCode !== "FAIAG0000") {
    throw new Error(`company-txt init_session failed: ${json.resCode} ${json.resMessage ?? ""}`.trim())
  }
  if (!json.data?.session_id) throw new Error("company-txt init_session response is missing session_id")
  return json.data.session_id
}

async function uploadFiles(baseURL: string, sessionID: string, metadata: RequestMetadata) {
  for (const upload of imageUploads(metadata)) {
    const form = new FormData()
    form.set("session_id", sessionID)
    form.set("file", new Blob([upload.content.slice().buffer], { type: upload.contentType }), upload.filename)
    const response = await fetch(`${baseURL}/chatabc/upload_file`, { method: "POST", body: form })
    if (!response.ok) throw new Error(`company-txt upload_file failed: ${response.status}`)
    const body = (await response.json().catch(() => ({}))) as { resCode?: string; resMessage?: string }
    if (body.resCode !== undefined && body.resCode !== "FAIAG0000") {
      throw new Error(`company-txt upload_file failed: ${body.resCode} ${body.resMessage ?? ""}`.trim())
    }
  }
}

function buildChatFiles(useType: string, metadata: RequestMetadata) {
  const files = [...arrayOption(metadata.files)]
  if (useType !== "agent") return files
  return [
    ...files,
    ...imageUploads(metadata).map((upload) => ({
      file_id: upload.filename.replace(/\.[^.]+$/, ""),
      url: upload.filename,
      content_type: "image",
    })),
  ]
}

function renderPrompt(request: ChatRequest, config: Record<string, unknown>) {
  const tools = renderToolDefinitions(request)
  const sections = [
    "# Conversation",
    "You are an AI assistant. Follow the messages in order.",
    "Do not output internal chat-template markers.",
  ]
  const renderedTools = renderTools(tools, config)
  if (renderedTools) sections.push(renderedTools)
  sections.push(renderMessages([...controlMessages(request, tools), ...(request.messages ?? [])]))
  if (config.add_generation_prompt !== false) sections.push("assistant:")
  return sections.filter((section) => section.trim()).join("\n\n")
}

function renderMessages(messages: ChatMessage[]) {
  const toolCallNamesByID = new Map<string, string>()
  return messages
    .map((message) => {
      const rendered = renderMessage(message, toolCallNamesByID)
      message.tool_calls?.forEach((toolCall) => {
        if (toolCall.id && toolCall.function?.name) toolCallNamesByID.set(toolCall.id, toolCall.function.name)
      })
      return rendered
    })
    .join("\n\n")
}

function renderTools(tools: unknown[] | undefined, config: Record<string, unknown>) {
  if (!tools) return
  return [
    "# Available Tools",
    "You may call tools only when needed. When calling a tool, output exactly one or more tool calls in the following native format and do not add extra prose around the tool call. Include every required property from the selected tool definition as its own parameter.",
    toolCallFormat(config),
    "Tool definitions:",
    JSON.stringify(tools),
  ].join("\n\n")
}

function controlMessages(request: ChatRequest, tools: unknown[] | undefined): ChatMessage[] {
  const instructions = [
    toolChoiceInstruction(request, tools),
    responseFormatInstruction(request.response_format),
    toolFailureRetryInstruction(request.messages),
  ].filter((item): item is string => Boolean(item))
  if (!instructions.length) return []
  return [{ role: "system", content: instructions.join("\n") }]
}

function toolChoiceInstruction(request: ChatRequest, tools: unknown[] | undefined) {
  if (!tools?.length) return
  if (request.tool_choice === "required") return "You must call one of the available tools. Do not answer directly."
  const selected = selectedToolName(request.tool_choice)
  if (!selected) return
  return `You must call the tool named \`${selected}\`. Do not answer directly or call a different tool.`
}

function responseFormatInstruction(format: Record<string, unknown> | undefined) {
  if (!format) return
  if (format.type === "json_object") return "Respond with a valid JSON object only."
  if (format.type === "json_schema") {
    return `Respond with JSON that conforms to the supplied json_schema. json_schema=${JSON.stringify(format.json_schema)}`
  }
}

function toolFailureRetryInstruction(messages: ChatMessage[] | undefined) {
  if (messages?.some(isInvalidToolArgumentMessage)) {
    return "A previous tool response reported invalid arguments. Treat it as a schema repair request: identify the original tool named in the error, call that original tool again with corrected arguments that satisfy its schema, and do not answer directly."
  }
  if (!messages?.some(isFailedToolMessage)) return
  return "A previous tool response reported a recoverable failure. Do not stop after the failed tool call; inspect the error, then retry the same tool with corrected arguments or use another appropriate tool before answering."
}

function isInvalidToolArgumentMessage(message: ChatMessage) {
  if (message.role !== "tool") return false
  const content = normalizedContent(message.content)
  return content.includes("invalid arguments") && content.includes("satisfies the expected schema")
}

function isFailedToolMessage(message: ChatMessage) {
  if (message.role !== "tool") return false
  const content = normalizedContent(message.content).toLowerCase()
  return TOOL_FAILURE_MARKERS.some((marker) => content.includes(marker))
}

const TOOL_FAILURE_MARKERS = [
  "schemaerror",
  "execution failed",
  "tool execution was interrupted",
  "does not exist",
  "not found",
  "permission denied",
  "access denied",
  "cannot ",
  "can't ",
]

function renderToolDefinitions(request: ChatRequest) {
  if (request.tool_choice === "none") return
  if (!request.tools?.length) return
  const selected = selectedToolName(request.tool_choice)
  if (!selected) return request.tools
  const tools = request.tools.filter((tool) => {
    if (!isRecord(tool)) return false
    const fn = tool.function
    return isRecord(fn) && fn.name === selected
  })
  return tools.length ? tools : request.tools
}

function renderMessage(message: ChatMessage, toolCallNamesByID: Map<string, string>) {
  const role = message.role === "developer" ? "system" : (message.role ?? "user")
  const content = normalizedContent(message.content)

  if (role === "assistant" && message.tool_calls?.length) {
    const calls = message.tool_calls.map(renderPreviousToolCall).join("\n")
    const prefix = `assistant:\n${content}`.trimEnd()
    return prefix ? `${prefix}\ntool_call:\n${calls}` : `tool_call:\n${calls}`
  }

  if (role === "tool") {
    const toolName = message.name ?? (message.tool_call_id ? toolCallNamesByID.get(message.tool_call_id) : undefined)
    const label = `tool_response name=${toolName ?? message.tool_call_id ?? "unknown"}${
      message.tool_call_id ? ` id=${message.tool_call_id}` : ""
    }`
    return `${label}:\n${content}`
  }

  if (role === "function") return `tool_response name=${message.name ?? "unknown"}:\n${content}`
  return `${role}:\n${content}`
}

function normalizedContent(input: unknown): string {
  if (typeof input === "string") return input
  if (!Array.isArray(input)) return input === undefined || input === null ? "" : JSON.stringify(input)
  return input
    .map((part) => {
      if (!isRecord(part)) return ""
      if (typeof part.text === "string") return part.text
      if (part.type === "image_url") return "[image]"
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function renderPreviousToolCall(call: ToolCall) {
  return `<tool_call>\n<function=${call.function?.name ?? "unknown"}>\n<parameter=arguments>\n${call.function?.arguments ?? "{}"}\n</parameter>\n</function>\n</tool_call>`
}

function toolCallFormat(config: Record<string, unknown>) {
  const adapter = stringOption(config.adapter) ?? stringOption(config.parser) ?? "qwen"
  if (adapter.includes("kimi")) {
    return '<|tool_calls_section_begin|><|tool_call_begin|>functions.tool-name:0<|tool_call_argument_begin|>{"param-key":"param-value"}<|tool_call_end|><|tool_calls_section_end|>'
  }
  if (adapter.includes("minimax")) {
    return '<minimax:tool_call>\n<invoke name="tool-name">\n<parameter name="param-key">param-value</parameter>\n</invoke>\n</minimax:tool_call>'
  }
  return "<tool_call>\n<function=tool-name>\n<parameter=param-key>\nparam-value\n</parameter>\n</function>\n</tool_call>"
}

async function streamResponse(
  body: ReadableStream<Uint8Array>,
  request: ChatRequest,
  model: Model,
  budget: ContextBudget,
  rawLogger?: CompanyTxtRawLogger,
) {
  const completionID = id("chatcmpl")
  const created = Math.floor(Date.now() / 1000)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const iterator = iterateCompanyEvents(body, rawLogger)
  const parser = outputParser(model)
  const stop = stopFilter(request, model)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const state: StreamTranslationState = { sentContent: "", pending: "", bufferingTool: false }
      const stopState = createStopState(stop)
      controller.enqueue(encoder.encode(roleChunk(completionID, created, request)))

      for await (const event of iterator) {
        if (event.event === "failed") {
          controller.enqueue(encoder.encode(sse({ error: { message: "company-txt upstream failed" } })))
          continue
        }
        const content = stringOption(event.data.content)
        if (!content) continue
        if (event.event === "message") {
          state.messageContent = content
          continue
        }
        if (event.event !== "chunk") continue
        const delta = pushStreamText(state, content)
        const filtered = delta ? pushStop(stopState, delta) : undefined
        if (filtered) controller.enqueue(encoder.encode(contentChunk(completionID, created, request, filtered)))
        if (stopState.stopped) break
      }

      if (state.messageContent !== undefined && !state.sentContent && !state.pending) {
        state.pending = state.messageContent
      }
      const rawOutput = state.messageContent ?? state.sentContent + state.pending
      const parsed = parser(rawOutput)
      await rawLogger?.log({ type: "parsed", raw_output: rawOutput, parsed })
      const finalDelta = finishStreamText(state, parsed)
      const filteredFinal = finalDelta ? pushStop(stopState, finalDelta) : undefined
      const stopTail = finishStop(stopState)
      if (filteredFinal) controller.enqueue(encoder.encode(contentChunk(completionID, created, request, filteredFinal)))
      if (stopTail) controller.enqueue(encoder.encode(contentChunk(completionID, created, request, stopTail)))

      if (parsed.type === "final") {
        controller.enqueue(encoder.encode(doneChunk(completionID, created, request, "stop")))
      } else if (!stopState.stopped) {
        applyToolCallPolicy(parsed.toolCalls, request).forEach((toolCall, index) =>
          controller.enqueue(encoder.encode(toolCallChunk(completionID, created, request, toolCall, index))),
        )
        controller.enqueue(encoder.encode(doneChunk(completionID, created, request, "tool_calls")))
      } else {
        controller.enqueue(encoder.encode(doneChunk(completionID, created, request, "stop")))
      }

      if (request.stream_options?.include_usage) {
        controller.enqueue(
          encoder.encode(
            sse({
              id: completionID,
              object: "chat.completion.chunk",
              created,
              model: request.model,
              choices: [],
              usage: await usage(budget, rawOutput, model),
            }),
          ),
        )
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
      decoder.decode()
    },
  })
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  })
}

async function collectCompletion(
  body: ReadableStream<Uint8Array>,
  request: ChatRequest,
  model: Model,
  budget: ContextBudget,
  rawLogger?: CompanyTxtRawLogger,
) {
  const chunks: string[] = []
  let messageContent: string | undefined
  for await (const event of iterateCompanyEvents(body, rawLogger)) {
    const content = stringOption(event.data.content)
    if (!content) continue
    if (event.event === "message") {
      messageContent = content
      continue
    }
    if (event.event === "chunk") chunks.push(content)
  }

  const content = messageContent ?? chunks.join("")
  const parsed = applyStop(outputParser(model)(content), stopFilter(request, model))
  await rawLogger?.log({ type: "parsed", raw_output: content, parsed })
  const message =
    parsed.type === "tool_calls"
      ? {
          role: "assistant",
          content: parsed.content ?? null,
          tool_calls: applyToolCallPolicy(parsed.toolCalls, request),
        }
      : { role: "assistant", content: parsed.content }
  return {
    id: id("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [{ index: 0, message, finish_reason: parsed.type === "tool_calls" ? "tool_calls" : "stop" }],
    usage: await usage(budget, content, model),
  }
}

async function* iterateCompanyEvents(
  body: ReadableStream<Uint8Array>,
  rawLogger?: CompanyTxtRawLogger,
): AsyncGenerator<CompanyStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const part = await reader.read()
    if (part.done) break
    buffer += decoder.decode(part.value, { stream: true })
    const blocks = buffer.split(/\n\n/)
    buffer = blocks.pop() ?? ""
    for (const block of blocks) {
      const event = parseCompanyEvent(block)
      await rawLogger?.log({ type: "event", raw: block, event: event.event, data: event.data })
      yield event
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    const event = parseCompanyEvent(buffer)
    await rawLogger?.log({ type: "event", raw: buffer, event: event.event, data: event.data })
    yield event
  }
}

function parseCompanyEvent(block: string): CompanyStreamEvent {
  const event = block
    .split(/\n/)
    .find((line) => line.startsWith("event:"))
    ?.replace(/^event:\s*/, "")
    .trim()
  const data = block
    .split(/\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .join("\n")
    .trim()
  return { event: event || "message", data: parseJsonRecord(data) }
}

function outputParser(model: Model): (raw: string) => ParsedOutput {
  const key = [model.options.adapter, model.options.parser]
    .map((item) => String(item ?? ""))
    .join(":")
    .toLowerCase()
  if (key.includes("kimi")) return parseKimiOutput
  if (key.includes("minimax")) return parseMiniMaxOutput
  return parseQwenOutput
}

function parseQwenOutput(raw: string): ParsedOutput {
  const matches = [...raw.matchAll(/<tool_call>\s*(?<body>.*?)\s*<\/tool_call>/gs)]
  if (!matches.length) return { type: "final", content: raw.trim() }
  return {
    type: "tool_calls",
    content: raw.replace(/<tool_call>\s*.*?\s*<\/tool_call>/gs, "").trim() || undefined,
    toolCalls: matches.map((match) => {
      const body = match.groups?.body?.trim() ?? ""
      if (body.startsWith("{")) return jsonToolCall(body)
      const fn = /<function=(?<name>.*?)>\s*(?<body>.*?)<\/function>/s.exec(body)
      if (!fn?.groups?.name) throw new Error("company-txt qwen tool call parse failed")
      const args = Object.fromEntries(
        [...(fn.groups.body ?? "").matchAll(/<parameter=(?<name>.*?)>\s*(?<value>.*?)\s*<\/parameter>/gs)].map(
          (param) => [param.groups?.name?.trim() ?? "", parseParameter(param.groups?.value?.trim() ?? "")],
        ),
      )
      return openAIToolCall(id("call"), fn.groups.name.trim(), args)
    }),
  }
}

function parseKimiOutput(raw: string): ParsedOutput {
  const sections = [...raw.matchAll(/<\|tool_calls_section_begin\|>(?<section>.*?)<\|tool_calls_section_end\|>/gs)]
  const search = sections.length ? sections.map((match) => match.groups?.section ?? "").join("\n") : raw
  const matches = [
    ...search.matchAll(
      /<\|tool_call_begin\|>\s*(?<id>[\w.:-]+)\s*<\|tool_call_argument_begin\|>\s*(?<args>.*?)\s*<\|tool_call_end\|>/gs,
    ),
  ]
  if (!matches.length) return { type: "final", content: raw.trim() }
  return {
    type: "tool_calls",
    content: raw.replace(/<\|tool_calls_section_begin\|>.*?<\|tool_calls_section_end\|>/gs, "").trim() || undefined,
    toolCalls: matches.map((match) =>
      openAIToolCall(
        match.groups?.id ?? id("call"),
        kimiFunctionName(match.groups?.id ?? ""),
        parseObject(match.groups?.args ?? "{}"),
      ),
    ),
  }
}

function parseMiniMaxOutput(raw: string): ParsedOutput {
  const matches = [...raw.matchAll(/<minimax:tool_call>\s*(?<body>.*?)\s*<\/minimax:tool_call>/gs)]
  const consumedSpans = matches.map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length] as const)
  const partialMatches = [...raw.matchAll(/<minimax:tool_call>\s*(?<body>.*)$/gs)].filter(
    (match) =>
      !consumedSpans.some(([start, end]) => start <= (match.index ?? 0) && (match.index ?? 0) < end) &&
      minimaxInvoke(match.groups?.body ?? ""),
  )
  const bodies = [...matches, ...partialMatches].map((match) => match.groups?.body ?? "")
  if (!bodies.length) return { type: "final", content: raw.trim() }
  return {
    type: "tool_calls",
    content: raw
      .replace(/<minimax:tool_call>\s*.*?\s*<\/minimax:tool_call>/gs, "")
      .replace(/<minimax:tool_call>\s*.*$/s, "")
      .trim() || undefined,
    toolCalls: bodies.map((body) => {
      if (body.trim().startsWith("{")) return jsonToolCall(body.trim())
      const invoke = minimaxInvoke(body)
      if (!invoke?.name) throw new Error("company-txt minimax tool call parse failed")
      const args = Object.fromEntries(
        [
          ...invoke.body.matchAll(
            /<parameter\s+name=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|(?<bare>[^\s>]+))\s*>\s*(?<value>.*?)\s*<\/parameter>/gs,
          ),
        ].map((param) => [
          (param.groups?.double ?? param.groups?.single ?? param.groups?.bare ?? "").trim(),
          parseParameter(param.groups?.value?.trim() ?? ""),
        ]),
      )
      return openAIToolCall(id("call"), invoke.name.trim(), args)
    }),
  }
}

function minimaxInvoke(body: string) {
  const invoke =
    /<invoke\s+name=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|(?<bare>[^\s>]+))\s*>\s*(?<body>.*?)\s*<\/invoke>/s.exec(
      body,
    )
  if (!invoke?.groups) return
  return {
    name: invoke.groups.double ?? invoke.groups.single ?? invoke.groups.bare ?? "",
    body: invoke.groups.body ?? "",
  }
}

function jsonToolCall(raw: string) {
  const parsed = parseObject(raw)
  return openAIToolCall(
    stringOption(parsed.id) ?? id("call"),
    stringOption(parsed.name) ?? "unknown",
    parseObject(parsed.arguments ?? {}),
  )
}

function openAIToolCall(callID: string, name: string, args: Record<string, unknown>): OpenAIToolCall {
  return { id: callID, type: "function", function: { name, arguments: JSON.stringify(args) } }
}

function kimiFunctionName(callID: string) {
  return (
    /^functions\.(?<name>[A-Za-z_][\w.-]*):\d+$/.exec(callID)?.groups?.name ??
    callID.split(/[:|\s]+/).find((part) => part && !part.startsWith("call_")) ??
    "unknown"
  )
}

function selectedToolName(input: unknown) {
  if (!isRecord(input) || !isRecord(input.function)) return
  return stringOption(input.function.name)
}

function contentChunk(id: string, created: number, request: ChatRequest, content: string) {
  return sse({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })
}

function toolCallChunk(id: string, created: number, request: ChatRequest, toolCall: OpenAIToolCall, index: number) {
  return sse({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model,
    choices: [{ index, delta: { tool_calls: [{ index, ...toolCall }] }, finish_reason: null }],
  })
}

function doneChunk(id: string, created: number, request: ChatRequest, finishReason: string) {
  return sse({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  })
}

function roleChunk(id: string, created: number, request: ChatRequest) {
  return sse({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  })
}

function sse(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
}

function errorResponse(message: string, code: string, status: number, param?: string) {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: status >= 500 ? "server_error" : "invalid_request_error",
        param: param ?? null,
        code,
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  )
}

function createCompanyTxtRawLogger(
  request: ChatRequest,
  model: Model,
  metadata: RequestMetadata,
  sessionID: string,
  options: CompanyTxtFetchOptions,
): CompanyTxtRawLogger {
  const directory = path.join(companyTxtLogRoot(metadata, options.logRoot), ".opencode")
  const file = path.join(directory, "company-txt-raw.log")
  const ready = fs.mkdir(directory, { recursive: true }).catch(() => undefined)
  return {
    log: async (record) => {
      try {
        await ready
        await fs.appendFile(
          file,
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            provider: "company-txt",
            model: request.model ?? model.id,
            configured_model: model.id,
            company_session_id: sessionID,
            ...record,
          })}\n`,
        )
      } catch {}
    },
  }
}

function companyTxtLogRoot(metadata: RequestMetadata, fallbackRoot?: string) {
  return (
    [
      stringOption(metadata.worktree),
      stringOption(metadata.root),
      stringOption(metadata.project_root),
      stringOption(metadata.projectRoot),
      isRecord(metadata.path) ? stringOption(metadata.path.root) : undefined,
      stringOption(fallbackRoot),
      stringOption(metadata.directory),
      stringOption(metadata.cwd),
      isRecord(metadata.path) ? stringOption(metadata.path.cwd) : undefined,
      process.cwd(),
    ].find((item) => item && path.isAbsolute(item)) ?? process.cwd()
  )
}

function pushStreamText(state: StreamTranslationState, text: string) {
  state.pending += text
  if (state.bufferingTool) return

  const markerIndex = firstToolMarkerIndex(state.pending)
  if (markerIndex !== undefined) {
    state.bufferingTool = true
    return flushStreamText(state, markerIndex)
  }

  const safeLength = Math.max(0, state.pending.length - Math.min(state.pending.length, MAX_TOOL_MARKER_LENGTH - 1))
  if (safeLength <= 0) return
  return flushStreamText(state, safeLength)
}

function finishStreamText(state: StreamTranslationState, parsed: ParsedOutput) {
  if (parsed.type === "tool_calls") {
    const content = parsed.content ?? ""
    const unsent = content.slice(state.sentContent.length)
    state.pending = ""
    return unsent || undefined
  }

  return flushStreamText(state, state.pending.length)
}

function flushStreamText(state: StreamTranslationState, length: number) {
  const content = state.pending.slice(0, length)
  state.pending = state.pending.slice(length)
  if (!content) return
  state.sentContent += content
  return content
}

function firstToolMarkerIndex(text: string) {
  const indexes = TOOL_MARKERS.map((marker) => text.indexOf(marker)).filter((index) => index >= 0)
  if (!indexes.length) return
  return Math.min(...indexes)
}

function createStopState(stop: string[]): StopState {
  return {
    stop,
    pending: "",
    stopped: false,
    keepLength: Math.max(0, Math.max(...stop.map((item) => item.length), 0) - 1),
  }
}

function pushStop(state: StopState, text: string) {
  if (state.stopped) return
  if (!state.stop.length) return text
  state.pending += text
  const stopIndex = firstStopIndex(state.pending, state.stop)
  if (stopIndex !== undefined) {
    const content = state.pending.slice(0, stopIndex)
    state.pending = ""
    state.stopped = true
    return content || undefined
  }
  const safeLength = Math.max(0, state.pending.length - state.keepLength)
  if (safeLength <= 0) return
  const content = state.pending.slice(0, safeLength)
  state.pending = state.pending.slice(safeLength)
  return content || undefined
}

function finishStop(state: StopState) {
  if (state.stopped || !state.pending) return
  const content = state.pending
  state.pending = ""
  return content
}

function firstStopIndex(text: string, stop: string[]) {
  const indexes = stop.map((item) => text.indexOf(item)).filter((index) => index >= 0)
  if (!indexes.length) return
  return Math.min(...indexes)
}

async function buildRequestMetadata(request: ChatRequest, provider: Info, model: Model): Promise<RequestMetadata> {
  const metadata: RequestMetadata = { ...(request.metadata ?? {}) }
  delete metadata.image_uploads
  const uploads = await collectImageUploads(
    request.messages ?? [],
    numberOption(model.options.maxUploadImages) ?? numberOption(provider.options.maxUploadImages) ?? 1,
    numberOption(model.options.maxUploadImageBytes) ??
      numberOption(provider.options.maxUploadImageBytes) ??
      10 * 1024 * 1024,
  )
  if (uploads.length) metadata.image_uploads = uploads
  return metadata
}

async function collectImageUploads(messages: ChatMessage[], maxImages: number, maxImageBytes: number) {
  const urls = messages.flatMap((message) => imageURLs(message.content))
  if (urls.length > maxImages)
    throw new CompanyTxtRequestError(`company-txt supports at most ${maxImages} image input(s)`, { param: "messages" })
  return Promise.all(urls.map((url, index) => imageUpload(url, index + 1, maxImageBytes)))
}

function imageURLs(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content
    .map((part) => {
      if (!isRecord(part) || part.type !== "image_url" || !isRecord(part.image_url)) return
      return stringOption(part.image_url.url)
    })
    .filter((url): url is string => Boolean(url))
}

async function imageUpload(url: string, index: number, maxBytes: number): Promise<ImageUpload> {
  if (url.startsWith("data:")) return dataURLImageUpload(url, index, maxBytes)
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new CompanyTxtRequestError("company-txt only supports data:image/...;base64 and http(s) image URLs", {
      param: "messages",
    })
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`company-txt failed to download image: ${response.status}`)
  const contentType = (response.headers.get("content-type") ?? "image/png").split(";")[0]!.trim()
  if (!contentType.startsWith("image/"))
    throw new CompanyTxtRequestError(`company-txt image URL returned ${contentType}`, { param: "messages" })
  const content = new Uint8Array(await response.arrayBuffer())
  validateImageBytes(content, maxBytes)
  return { filename: filenameFromURL(url, contentType, index), content, contentType }
}

function dataURLImageUpload(url: string, index: number, maxBytes: number): ImageUpload {
  const [header, payload] = splitOnce(url, ",")
  if (!header || !payload || !header.includes(";base64")) {
    throw new CompanyTxtRequestError("company-txt image data URL must be base64 encoded", { param: "messages" })
  }
  const contentType = header.replace(/^data:/, "").split(";")[0] || "image/png"
  if (!contentType.startsWith("image/"))
    throw new CompanyTxtRequestError(`company-txt unsupported image content type: ${contentType}`, {
      param: "messages",
    })
  const content = new Uint8Array(Buffer.from(payload, "base64"))
  validateImageBytes(content, maxBytes)
  return { filename: `image_${index}${extensionForContentType(contentType)}`, content, contentType }
}

function validateImageBytes(content: Uint8Array, maxBytes: number) {
  if (content.length > maxBytes)
    throw new CompanyTxtRequestError(`company-txt image input is too large: ${content.length} > ${maxBytes}`, {
      param: "messages",
    })
}

function filenameFromURL(url: string, contentType: string, index: number) {
  const name = new URL(url).pathname.split("/").filter(Boolean).pop()
  if (name?.includes(".")) return name
  return `image_${index}${extensionForContentType(contentType)}`
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/jpeg") return ".jpg"
  if (contentType === "image/webp") return ".webp"
  if (contentType === "image/gif") return ".gif"
  return ".png"
}

async function validatePrompt(
  prompt: string,
  request: ChatRequest,
  model: Model,
  metadata: RequestMetadata,
): Promise<ContextBudget> {
  const promptTokens =
    (await countCompanyTxtTokens(prompt, tokenizerName(model))) +
    imageTokenCount(imageUploads(metadata), model.options.image_token_budget)
  const completionTokens = Math.max(
    0,
    request.max_tokens ?? numberOption(model.options.max_output_tokens) ?? model.limit.output ?? 0,
  )
  const contextWindow = numberOption(model.options.context_window) ?? model.limit.context
  if (contextWindow > 0 && promptTokens + completionTokens > contextWindow) {
    throw new CompanyTxtRequestError(
      `company-txt context length exceeded: ${promptTokens + completionTokens} > ${contextWindow} tokens for ${model.id}`,
      { code: "context_length_exceeded", param: "messages" },
    )
  }
  return { promptTokens, completionTokens }
}

function imageTokenCount(uploads: ImageUpload[], config: unknown) {
  if (!uploads.length || !isRecord(config)) return 0
  if (config.mode === "fixed") return uploads.length * (numberOption(config.tokens_per_image) ?? 0)
  if (config.mode !== "qwen_vl") return 0
  return uploads.reduce((total, upload) => total + qwenVLImageTokens(upload, config), 0)
}

function qwenVLImageTokens(upload: ImageUpload, config: Record<string, unknown>) {
  const size = imageSize(upload.content)
  if (!size) return numberOption(config.fallback_tokens_per_image) ?? 0
  const patchSize = numberOption(config.patch_size) ?? 16
  const mergeSize = numberOption(config.merge_size) ?? 2
  const factor = patchSize * mergeSize
  const minPixels = numberOption(config.min_pixels) ?? 0
  const maxPixels = numberOption(config.max_pixels) ?? size.width * size.height
  const resized = smartResize(size.width, size.height, factor, minPixels, maxPixels)
  return Math.max(1, Math.floor(resized.width / factor) * Math.floor(resized.height / factor))
}

function imageSize(content: Uint8Array): { width: number; height: number } | undefined {
  if (content.length >= 24 && startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (content.length >= 10 && content[0] === 0xff && content[1] === 0xd8) return jpegSize(content)
  if (content.length >= 10 && String.fromCharCode(...content.slice(0, 3)) === "GIF") {
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength)
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (content.length >= 30 && String.fromCharCode(...content.slice(0, 4)) === "RIFF") return webpSize(content)
}

function jpegSize(content: Uint8Array) {
  let index = 2
  while (index + 9 < content.length) {
    if (content[index] !== 0xff) {
      index++
      continue
    }
    const marker = content[index + 1]
    index += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    const length = (content[index] << 8) + content[index + 1]
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        height: (content[index + 3] << 8) + content[index + 4],
        width: (content[index + 5] << 8) + content[index + 6],
      }
    index += length
  }
}

function webpSize(content: Uint8Array) {
  const header = String.fromCharCode(...content.slice(12, 16))
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength)
  if (header === "VP8 " && content.length >= 30)
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  if (header === "VP8L" && content.length >= 25) {
    const bits = content[21] | (content[22] << 8) | (content[23] << 16) | (content[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
}

function smartResize(width: number, height: number, factor: number, minPixels: number, maxPixels: number) {
  const roundBy = (value: number) => Math.round(value / factor) * factor
  const floorBy = (value: number) => Math.floor(value / factor) * factor
  const ceilBy = (value: number) => Math.ceil(value / factor) * factor
  const current = { width: Math.max(factor, roundBy(width)), height: Math.max(factor, roundBy(height)) }
  const pixels = current.width * current.height
  if (maxPixels > 0 && pixels > maxPixels) {
    const scale = Math.sqrt((width * height) / maxPixels)
    return { width: Math.max(factor, floorBy(width / scale)), height: Math.max(factor, floorBy(height / scale)) }
  }
  if (minPixels > 0 && pixels < minPixels) {
    const scale = Math.sqrt(minPixels / (width * height))
    return { width: Math.max(factor, ceilBy(width * scale)), height: Math.max(factor, ceilBy(height * scale)) }
  }
  return current
}

function stopFilter(request: ChatRequest, model: Model) {
  const raw = request.stop ?? model.options.native_stop_sequences
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String).filter(Boolean)
}

function applyStop(parsed: ParsedOutput, stop: string[]): ParsedOutput {
  if (!stop.length) return parsed
  if (parsed.type === "final") return { ...parsed, content: stopText(parsed.content, stop) }
  return parsed.content === undefined ? parsed : { ...parsed, content: stopText(parsed.content, stop) || undefined }
}

function applyToolCallPolicy(toolCalls: OpenAIToolCall[], request: ChatRequest) {
  if (request.parallel_tool_calls === false) return toolCalls.slice(0, 1)
  return toolCalls
}

function stopText(content: string, stop: string[]) {
  const indexes = stop.map((item) => content.indexOf(item)).filter((index) => index >= 0)
  if (!indexes.length) return content
  return content.slice(0, Math.min(...indexes))
}

async function usage(budget: ContextBudget, content: string, model: Model) {
  const completionTokens = await countCompanyTxtTokens(content, tokenizerName(model))
  return {
    prompt_tokens: budget.promptTokens,
    completion_tokens: completionTokens,
    total_tokens: budget.promptTokens + completionTokens,
  }
}

function parseParameter(value: string): unknown {
  if (value.toLowerCase() === "null") return null
  if (value.toLowerCase() === "true") return true
  if (value.toLowerCase() === "false") return false
  return parseJson(value, value)
}

function parseObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) return input
  return parseJson(String(input), {})
}

function parseJsonRecord(input: string): Record<string, unknown> {
  if (!input) return {}
  const parsed = parseJson(input, undefined)
  if (isRecord(parsed)) return parsed
  if (parsed !== undefined) return { value: parsed }
  return { content: input }
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T
  } catch {
    return fallback
  }
}

function stringOption(input: unknown) {
  return typeof input === "string" && input.trim() ? input.trim() : undefined
}

function numberOption(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function tokenizerName(model: Model) {
  const configured = stringOption(model.options.tokenizer)
  if (configured) return configured
  const key = [model.id, model.api.id, model.options.adapter, model.options.parser].join(":").toLowerCase()
  if (key.includes("kimi")) return "kimi_k2_5"
  if (key.includes("minimax")) return "minimax_m2_5"
  if (key.includes("qwen")) return "qwen3_6_35b_a3b"
}

function arrayOption(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isRecord) : []
}

function imageUploads(metadata: RequestMetadata) {
  return Array.isArray(metadata.image_uploads) ? metadata.image_uploads : []
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function splitOnce(input: string, search: string) {
  const index = input.indexOf(search)
  if (index === -1) return [input, ""] as const
  return [input.slice(0, index), input.slice(index + search.length)] as const
}

function startsWith(input: Uint8Array, bytes: number[]) {
  return bytes.every((byte, index) => input[index] === byte)
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`
}
