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

type ToolMarkerSpan = {
  contentLength: number
  consumeLength: number
}

type ToolCallStyle = "qwen" | "kimi" | "minimax"

type LiveToolCallDelta = {
  index: number
  id?: string
  type?: "function"
  function?: {
    name?: string
    arguments?: string
  }
}

type LiveStreamTranslationState = {
  sentContent: string
  pending: string
  rawOutput: string
  bufferingTool: boolean
  toolStarted: boolean
  toolIndex: number
  nativeState: string
  emittedArgumentPrefix: boolean
  activeParameterName?: string
  activeParameterBuffer: string
  activeParameterStreamingString: boolean
  activeToolName?: string
  activeToolCallID?: string
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
const MAX_TOOL_MARKER_KEEP_LENGTH = MAX_TOOL_MARKER_LENGTH + "tool_call:\n".length
const TEXT_FILE_CONTENT_PARAMETERS = new Set(["content", "oldString", "newString"])

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
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    if (isModels(input)) return jsonResponse(modelList(provider))
    if (!isChatCompletions(input)) return fetch(input, init)

    const signal = init?.signal ?? undefined
    try {
      const request = await readChatRequest(init?.body)
      const model = requireModel(provider, request.model)
      const config = model.options ?? {}
      const baseURL = selectBaseURL(model)
      const use = useType(config)
      const txtField = stringOption(provider.options.txtField) ?? stringOption(provider.options.txt_field) ?? "txt"
      const metadata = await buildRequestMetadata(request, provider, model, signal)
      const prompt = renderPrompt(request, config)
      const budget = await validatePrompt(prompt, request, model, metadata)
      const sessionID = await initSession(baseURL, use, metadata, signal)
      await uploadFiles(baseURL, sessionID, metadata, signal)
      const upstream = await fetch(`${baseURL}/chatabc/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
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
      if (request.stream) return streamResponse(upstream.body, request, model, budget)
      return jsonResponse(await collectCompletion(upstream.body, request, model, budget))
    } catch (error) {
      if (error instanceof CompanyTxtRequestError) {
        return errorResponse(error.message, error.code, error.status, error.param)
      }
      if (signal?.aborted) return errorResponse("company-txt request was aborted", "request_aborted", 499)
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
  try {
    if (typeof body === "string") return JSON.parse(body) as ChatRequest
    if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body)) as ChatRequest
    if (body instanceof Blob) return JSON.parse(await body.text()) as ChatRequest
  } catch {
    throw new CompanyTxtRequestError("company-txt request body must be valid JSON", { param: "body" })
  }
  throw new CompanyTxtRequestError("company-txt provider expected a JSON chat/completions body", { param: "body" })
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

async function initSession(
  baseURL: string,
  useType: string,
  metadata: RequestMetadata,
  signal: AbortSignal | undefined,
) {
  const response = await fetch(`${baseURL}/chatabc/init_session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
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

async function uploadFiles(
  baseURL: string,
  sessionID: string,
  metadata: RequestMetadata,
  signal: AbortSignal | undefined,
) {
  for (const upload of imageUploads(metadata)) {
    const form = new FormData()
    form.set("session_id", sessionID)
    form.set("file", new Blob([upload.content.slice().buffer], { type: upload.contentType }), upload.filename)
    const response = await fetch(`${baseURL}/chatabc/upload_file`, { method: "POST", body: form, signal })
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
  const finalAnswerFormat = finalAnswerFormatInstruction(request, config)
  if (finalAnswerFormat) sections.push(finalAnswerFormat)
  const renderedTools = renderTools(tools, config)
  if (renderedTools) sections.push(renderedTools)
  sections.push(renderMessages([...controlMessages(request, tools), ...(request.messages ?? [])], config))
  if (config.add_generation_prompt !== false) sections.push("assistant:")
  return sections.filter((section) => section.trim()).join("\n\n")
}

function finalAnswerFormatInstruction(request: ChatRequest, config: Record<string, unknown>) {
  if (request.response_format) return
  if (toolCallStyle(config) !== "minimax") return
  return [
    "# Final Answer Formatting",
    "When producing a final natural-language answer, use readable Markdown with real newline characters.",
    "Put headings, paragraphs, lists, tables, and fenced code blocks on separate lines; never collapse a Markdown answer into one paragraph with literal heading markers like ## embedded in prose.",
  ].join("\n")
}

function renderMessages(messages: ChatMessage[], config: Record<string, unknown>) {
  const toolCallNamesByID = new Map<string, string>()
  return messages
    .map((message) => {
      const rendered = renderMessage(message, toolCallNamesByID, config)
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
    fileContentToolInstruction(tools),
    toolCallFormat(config),
    "Tool definitions:",
    JSON.stringify(tools),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
}

function fileContentToolInstruction(tools: unknown[]) {
  if (!tools.some(isFileContentTool)) return
  return [
    "When using write or edit tools for source files, preserve human-readable multi-line formatting and indentation in content, oldString, and newString.",
    "Do not minify HTML, CSS, JavaScript, TypeScript, JSX, TSX, Vue, JSON, Markdown, or source code unless the user explicitly asks for minified output.",
  ].join(" ")
}

function isFileContentTool(tool: unknown) {
  if (!isRecord(tool) || !isRecord(tool.function)) return false
  const name = stringOption(tool.function.name)
  return name === "write" || name === "edit"
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
  const recent = recentMessagesSinceLastUser(messages)
  const invalidArgumentCount = recent.filter(isInvalidToolArgumentMessage).length
  if (invalidArgumentCount > 1) {
    return "Previous tool responses repeatedly reported invalid arguments. Do not retry the same tool call with the same argument shape. If you can provide valid corrected arguments, do so once; otherwise explain the blocker or choose a materially different tool/input."
  }
  if (invalidArgumentCount === 1) {
    return "A previous tool response reported invalid arguments. Treat it as a schema repair request: identify the original tool named in the error, call that original tool again with corrected arguments that satisfy its schema, and do not answer directly."
  }
  const failedToolCount = recent.filter(isNonArgumentToolFailureMessage).length
  if (failedToolCount > 1) {
    return "Previous tool responses repeatedly reported recoverable failures. Do not retry the same failing tool call unchanged. Try a materially different tool/input if available; otherwise explain the blocker."
  }
  if (!failedToolCount) return
  return "A previous tool response reported a recoverable failure. Do not stop after the failed tool call; inspect the error, then retry the same tool with corrected arguments or use another appropriate tool before answering."
}

function recentMessagesSinceLastUser(messages: ChatMessage[] | undefined) {
  if (!messages?.length) return []
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user")
  return lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages
}

function isInvalidToolArgumentMessage(message: ChatMessage) {
  if (message.role !== "tool") return false
  const content = normalizedContent(message.content).toLowerCase()
  return content.includes("invalid arguments") && content.includes("satisfies the expected schema")
}

function isFailedToolMessage(message: ChatMessage) {
  if (message.role !== "tool") return false
  const content = normalizedContent(message.content).toLowerCase()
  return TOOL_FAILURE_MARKERS.some((marker) => content.includes(marker))
}

function isNonArgumentToolFailureMessage(message: ChatMessage) {
  return isFailedToolMessage(message) && !isInvalidToolArgumentMessage(message)
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

function renderMessage(message: ChatMessage, toolCallNamesByID: Map<string, string>, config: Record<string, unknown>) {
  const role = message.role === "developer" ? "system" : (message.role ?? "user")
  const content = normalizedContent(message.content)

  if (role === "assistant" && message.tool_calls?.length) {
    const calls = message.tool_calls.map((call) => renderPreviousToolCall(call, config)).join("\n")
    const prefix = `assistant:\n${content}`.trimEnd()
    return prefix ? `${prefix}\n${calls}` : `assistant:\n${calls}`
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

function renderPreviousToolCall(call: ToolCall, config: Record<string, unknown>) {
  const style = toolCallStyle(config)
  if (style === "kimi") return renderKimiPreviousToolCall(call)
  if (style === "minimax") return renderMiniMaxPreviousToolCall(call)
  return renderQwenPreviousToolCall(call)
}

function renderQwenPreviousToolCall(call: ToolCall) {
  const parameters = Object.entries(toolCallArguments(call))
    .map(([name, value]) => `<parameter=${name}>\n${stringifyToolArgument(value)}\n</parameter>`)
    .join("\n")
  return `<tool_call>\n<function=${call.function?.name ?? "unknown"}>\n${parameters}\n</function>\n</tool_call>`
}

function renderKimiPreviousToolCall(call: ToolCall) {
  return `<|tool_calls_section_begin|><|tool_call_begin|>functions.${call.function?.name ?? "unknown"}:0<|tool_call_argument_begin|>${JSON.stringify(toolCallArguments(call))}<|tool_call_end|><|tool_calls_section_end|>`
}

function renderMiniMaxPreviousToolCall(call: ToolCall) {
  const parameters = Object.entries(toolCallArguments(call))
    .map(
      ([name, value]) =>
        `<parameter name="${escapeXml(name)}">${stringifyToolArgument(value)}</parameter>`,
    )
    .join("")
  return `<minimax:tool_call><invoke name="${escapeXml(call.function?.name ?? "unknown")}">${parameters}</invoke></minimax:tool_call>`
}

function toolCallArguments(call: ToolCall) {
  const raw = call.function?.arguments
  if (!raw) return {}
  const parsed = parseJson<unknown>(raw, undefined)
  if (isRecord(parsed)) return parsed
  return { _raw: raw }
}

function stringifyToolArgument(value: unknown) {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))
}

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function toolCallFormat(config: Record<string, unknown>) {
  const style = toolCallStyle(config)
  if (style === "kimi") {
    return [
      '<|tool_calls_section_begin|><|tool_call_begin|>functions.tool-name:0<|tool_call_argument_begin|>{"param-key":"param-value"}<|tool_call_end|><|tool_calls_section_end|>',
      "",
      "Rules for Kimi tool calls:",
      "1. The text after <|tool_call_argument_begin|> must be one strict JSON object.",
      '2. JSON string values must escape inner double quotes as \\".',
      "3. When passing source code, HTML, shell commands, regular expressions, or JSON text as a parameter value, keep the value inside a JSON string and escape every required character.",
      "",
      "Example with source code content:",
      '<|tool_calls_section_begin|><|tool_call_begin|>functions.write:0<|tool_call_argument_begin|>{"content":"<script setup lang=\\"ts\\">\\nconst name = \\"demo\\"\\n</script>","filePath":"src/App.vue"}<|tool_call_end|><|tool_calls_section_end|>',
    ].join("\n")
  }
  if (style === "minimax") {
    return '<minimax:tool_call>\n<invoke name="tool-name">\n<parameter name="param-key">param-value</parameter>\n</invoke>\n</minimax:tool_call>'
  }
  return "<tool_call>\n<function=tool-name>\n<parameter=param-key>\nparam-value\n</parameter>\n</function>\n</tool_call>"
}

function toolCallStyle(config: Record<string, unknown>): ToolCallStyle {
  const adapter = (stringOption(config.adapter) ?? stringOption(config.parser) ?? "qwen").toLowerCase()
  if (adapter.includes("kimi")) return "kimi"
  if (adapter.includes("minimax")) return "minimax"
  return "qwen"
}

function streamToolCallMode(config: Record<string, unknown>) {
  return stringOption(config.streamToolCallMode)?.toLowerCase() === "live_delta" ||
    stringOption(config.stream_tool_call_mode)?.toLowerCase() === "live_delta"
    ? "live_delta"
    : "complete"
}

async function streamResponse(
  body: ReadableStream<Uint8Array>,
  request: ChatRequest,
  model: Model,
  budget: ContextBudget,
) {
  const completionID = id("chatcmpl")
  const created = Math.floor(Date.now() / 1000)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const iterator = iterateCompanyEvents(body)
  const parser = outputParser(model)
  const stop = stopFilter(request, model)
  const config = model.options ?? {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (streamToolCallMode(config) === "live_delta") {
        await streamLiveDelta(controller, {
          completionID,
          created,
          request,
          model,
          budget,
          iterator,
          parser,
          stop,
          encoder,
        })
        decoder.decode()
        return
      }
      const state: StreamTranslationState = { sentContent: "", pending: "", bufferingTool: false }
      const stopState = createStopState(stop)
      controller.enqueue(encoder.encode(roleChunk(completionID, created, request)))

      for await (const event of iterator) {
        if (event.event === "failed") {
          controller.enqueue(encoder.encode(sse({ error: { message: "company-txt upstream failed" } })))
          continue
        }
        const content = contentOption(event.data.content)
        if (content === undefined) continue
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

async function streamLiveDelta(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: {
    completionID: string
    created: number
    request: ChatRequest
    model: Model
    budget: ContextBudget
    iterator: AsyncGenerator<CompanyStreamEvent>
    parser: (raw: string) => ParsedOutput
    stop: string[]
    encoder: TextEncoder
  },
) {
  const style = toolCallStyle(input.model.options ?? {})
  const state = createLiveStreamState(style)
  const stopState = createStopState(input.stop)
  controller.enqueue(input.encoder.encode(roleChunk(input.completionID, input.created, input.request)))

  for await (const event of input.iterator) {
    if (event.event === "failed") {
      controller.enqueue(input.encoder.encode(sse({ error: { message: "company-txt upstream failed" } })))
      continue
    }
    const content = contentOption(event.data.content)
    if (content === undefined) continue
    if (event.event === "message") {
      state.messageContent = content
      continue
    }
    if (event.event !== "chunk") continue
    const step = pushLiveStreamText(state, style, content)
    const filtered = step.content ? pushStop(stopState, step.content) : undefined
    if (filtered) controller.enqueue(input.encoder.encode(contentChunk(input.completionID, input.created, input.request, filtered)))
    if (stopState.stopped) break
    applyLiveToolCallPolicy(step.toolCalls, input.request).forEach((delta) =>
      controller.enqueue(input.encoder.encode(toolCallDeltaChunk(input.completionID, input.created, input.request, delta))),
    )
  }

  if (state.messageContent !== undefined && !state.rawOutput) {
    state.pending = state.messageContent
    state.rawOutput = state.messageContent
  }
  const rawOutput = state.messageContent ?? state.rawOutput
  const parsed = input.parser(rawOutput)
  const finalDelta = finishLiveStreamText(state)
  const filteredFinal = finalDelta ? pushStop(stopState, finalDelta) : undefined
  const stopTail = finishStop(stopState)
  if (filteredFinal) {
    controller.enqueue(input.encoder.encode(contentChunk(input.completionID, input.created, input.request, filteredFinal)))
  }
  if (stopTail) controller.enqueue(input.encoder.encode(contentChunk(input.completionID, input.created, input.request, stopTail)))

  controller.enqueue(
    input.encoder.encode(
      doneChunk(
        input.completionID,
        input.created,
        input.request,
        state.toolStarted && parsed.type === "tool_calls" && !stopState.stopped ? "tool_calls" : "stop",
      ),
    ),
  )
  if (input.request.stream_options?.include_usage) {
    controller.enqueue(
      input.encoder.encode(
        sse({
          id: input.completionID,
          object: "chat.completion.chunk",
          created: input.created,
          model: input.request.model,
          choices: [],
          usage: await usage(input.budget, rawOutput, input.model),
        }),
      ),
    )
  }
  controller.enqueue(input.encoder.encode("data: [DONE]\n\n"))
  controller.close()
}

async function collectCompletion(
  body: ReadableStream<Uint8Array>,
  request: ChatRequest,
  model: Model,
  budget: ContextBudget,
) {
  const chunks: string[] = []
  let messageContent: string | undefined
  for await (const event of iterateCompanyEvents(body)) {
    const content = contentOption(event.data.content)
    if (content === undefined) continue
    if (event.event === "message") {
      messageContent = content
      continue
    }
    if (event.event === "chunk") chunks.push(content)
  }

  const content = messageContent ?? chunks.join("")
  const parsed = applyStop(outputParser(model)(content), stopFilter(request, model))
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

async function* iterateCompanyEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<CompanyStreamEvent> {
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
      yield event
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    const event = parseCompanyEvent(buffer)
    yield event
  }
}

function parseCompanyEvent(block: string): CompanyStreamEvent {
  const lines = block.split(/\n/).map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.replace(/^event: ?/, "")
    .trim()
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data: ?/, ""))
    .join("\n")
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
  if (!matches.length) return { type: "final", content: raw }
  return {
    type: "tool_calls",
    content: toolCallContent(raw.replace(/<tool_call>\s*.*?\s*<\/tool_call>/gs, "")),
    toolCalls: matches.map((match) => {
      const body = match.groups?.body?.trim() ?? ""
      if (body.startsWith("{")) return jsonToolCall(body)
      const fn = /<function=(?<name>.*?)>\s*(?<body>.*?)<\/function>/s.exec(body)
      if (!fn?.groups?.name) throw new Error("company-txt qwen tool call parse failed")
      const toolName = fn.groups.name.trim()
      const args = Object.fromEntries(
        [...(fn.groups.body ?? "").matchAll(/<parameter=(?<name>.*?)>(?<value>.*?)<\/parameter>/gs)].map(
          (param) => {
            const parameterName = param.groups?.name?.trim() ?? ""
            return [parameterName, parseToolParameter(toolName, parameterName, param.groups?.value ?? "")]
          },
        ),
      )
      return openAIToolCall(id("call"), toolName, args)
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
  if (!matches.length) return { type: "final", content: raw }
  return {
    type: "tool_calls",
    content: toolCallContent(raw.replace(/<\|tool_calls_section_begin\|>.*?<\|tool_calls_section_end\|>/gs, "")),
    toolCalls: matches.map((match) => {
      const callID = match.groups?.id ?? id("call")
      return openAIToolCall(
        callID,
        kimiFunctionName(callID),
        parseKimiToolArguments(match.groups?.args ?? "{}", callID),
      )
    }),
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
  if (!bodies.length) return { type: "final", content: raw }
  return {
    type: "tool_calls",
    content: toolCallContent(
      raw
        .replace(/<minimax:tool_call>\s*.*?\s*<\/minimax:tool_call>/gs, "")
        .replace(/<minimax:tool_call>\s*.*$/s, ""),
    ),
    toolCalls: bodies.map((body) => {
      if (body.trim().startsWith("{")) return jsonToolCall(body.trim())
      const invoke = minimaxInvoke(body)
      if (!invoke?.name) throw new Error("company-txt minimax tool call parse failed")
      const toolName = invoke.name.trim()
      const args = Object.fromEntries(
        [
          ...invoke.body.matchAll(
            /<parameter\s+name=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|(?<bare>[^\s>]+))\s*>(?<value>.*?)<\/parameter>/gs,
          ),
        ].map((param) => {
          const parameterName = (param.groups?.double ?? param.groups?.single ?? param.groups?.bare ?? "").trim()
          return [parameterName, parseToolParameter(toolName, parameterName, param.groups?.value ?? "")]
        }),
      )
      return openAIToolCall(id("call"), toolName, args)
    }),
  }
}

function toolCallContent(content: string) {
  return content.replace(/(?:^|\n)[ \t]*tool_call:\s*$/i, "").trim() || undefined
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
  return { id: callID, type: "function", function: { name, arguments: JSON.stringify(normalizeToolArguments(name, args)) } }
}

function kimiFunctionName(callID: string) {
  return (
    /^functions\.(?<name>[A-Za-z_][\w.-]*):\d+$/.exec(callID)?.groups?.name ??
    callID.split(/[:|\s]+/).find((part) => part && !part.startsWith("call_")) ??
    "unknown"
  )
}

function parseKimiToolArguments(input: string, callID: string) {
  return parseStrictObject(
    input,
    `company-txt kimi tool call arguments must be a valid JSON object for ${callID}`,
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

function toolCallDeltaChunk(id: string, created: number, request: ChatRequest, toolCall: LiveToolCallDelta) {
  return sse({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model,
    choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }],
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

function createLiveStreamState(style: ToolCallStyle): LiveStreamTranslationState {
  return {
    sentContent: "",
    pending: "",
    rawOutput: "",
    bufferingTool: false,
    toolStarted: false,
    toolIndex: 0,
    nativeState: initialNativeState(style),
    emittedArgumentPrefix: false,
    activeParameterBuffer: "",
    activeParameterStreamingString: false,
  }
}

function pushLiveStreamText(state: LiveStreamTranslationState, style: ToolCallStyle, text: string) {
  state.rawOutput += text
  state.pending += text
  const toolCalls: LiveToolCallDelta[] = []
  const marker = toolMarker(style)

  if (!state.bufferingTool) {
    const span = toolMarkerSpan(state.pending, marker)
    if (!span) return { content: flushLiveSafeContent(state, marker), toolCalls }
    const content = flushLiveContent(state, span.contentLength)
    state.pending = state.pending.slice(span.consumeLength - span.contentLength)
    state.bufferingTool = true
    state.nativeState = initialNativeState(style)
    toolCalls.push(...consumeLiveToolBuffer(state, style))
    return { content, toolCalls }
  }

  toolCalls.push(...consumeLiveToolBuffer(state, style))
  return { content: undefined, toolCalls }
}

function finishLiveStreamText(state: LiveStreamTranslationState) {
  if (state.toolStarted) return
  if (!state.pending) return
  return flushLiveContent(state, state.pending.length)
}

function consumeLiveToolBuffer(state: LiveStreamTranslationState, style: ToolCallStyle): LiveToolCallDelta[] {
  if (style === "kimi") return consumeLiveKimi(state)
  if (style === "minimax") return consumeLiveMiniMax(state)
  return consumeLiveQwen(state)
}

function consumeLiveKimi(state: LiveStreamTranslationState): LiveToolCallDelta[] {
  const deltas: LiveToolCallDelta[] = []
  const argumentMarker = "<|tool_call_argument_begin|>"
  const endMarker = "<|tool_call_end|>"

  while (state.pending) {
    if (state.nativeState === "done") {
      if (beginNextLiveToolCall(state, "kimi")) continue
      return deltas
    }
    if (state.nativeState === "kimi_header") {
      state.pending = state.pending.trimStart()
      if (state.pending.startsWith("<|tool_call_begin|>")) state.pending = state.pending.slice("<|tool_call_begin|>".length)
      const markerIndex = state.pending.indexOf(argumentMarker)
      if (markerIndex < 0) return deltas
      const callID = state.pending.slice(0, markerIndex).trim()
      state.pending = state.pending.slice(markerIndex + argumentMarker.length)
      deltas.push(startLiveToolCall(state, kimiFunctionName(callID), callID))
      state.nativeState = "kimi_arguments"
      continue
    }
    if (state.nativeState === "kimi_arguments") {
      const endIndex = state.pending.indexOf(endMarker)
      if (endIndex >= 0) {
        state.activeParameterBuffer += state.pending.slice(0, endIndex)
        deltas.push(
          argumentsLiveDelta(
            state,
            JSON.stringify(
              normalizeToolArguments(
                state.activeToolName ?? "",
                parseKimiToolArguments(
                  state.activeParameterBuffer,
                  state.activeToolCallID ?? state.activeToolName ?? "unknown",
                ),
              ),
            ),
          ),
        )
        state.pending = state.pending.slice(endIndex + endMarker.length)
        state.activeParameterBuffer = ""
        consumeOptionalKimiSectionEnd(state)
        state.nativeState = "done"
        continue
      }
      const safeLength = liveSafeFlushLength(state.pending, endMarker)
      if (safeLength > 0) {
        state.activeParameterBuffer += state.pending.slice(0, safeLength)
        state.pending = state.pending.slice(safeLength)
      }
      return deltas
    }
    return deltas
  }
  return deltas
}

function consumeLiveQwen(state: LiveStreamTranslationState): LiveToolCallDelta[] {
  const deltas: LiveToolCallDelta[] = []
  while (state.pending) {
    if (state.nativeState === "done") {
      if (beginNextLiveToolCall(state, "qwen")) continue
      return deltas
    }
    if (state.nativeState === "qwen_function") {
      if (state.pending.trimStart().startsWith("{")) {
        deltas.push(...consumeLiveQwenJsonToolCall(state))
        continue
      }
      const match = /<function=(?<name>.*?)>/s.exec(state.pending)
      if (!match?.groups?.name) return deltas
      state.pending = state.pending.slice(match.index + match[0].length)
      deltas.push(startLiveToolCall(state, match.groups.name.trim()))
      state.nativeState = "qwen_body"
      continue
    }
    if (state.nativeState === "qwen_body") {
      const parameterMatch = /<parameter=(?<name>.*?)>/s.exec(state.pending)
      const functionEnd = state.pending.indexOf("</function>")
      if (parameterMatch?.groups?.name && (functionEnd < 0 || parameterMatch.index < functionEnd)) {
        state.pending = state.pending.slice(parameterMatch.index + parameterMatch[0].length)
        beginLiveParameter(state, parameterMatch.groups.name.trim())
        state.nativeState = "qwen_parameter"
        continue
      }
      if (functionEnd >= 0) {
        deltas.push(...finishLiveArgumentObject(state))
        state.pending = state.pending.slice(functionEnd + "</function>".length)
        consumeOptionalLiveSuffix(state, "</tool_call>")
        state.nativeState = "done"
        continue
      }
      return deltas
    }
    if (state.nativeState === "qwen_parameter") {
      deltas.push(...consumeLiveParameterValue(state, "qwen", "</parameter>"))
      if ((state as LiveStreamTranslationState).nativeState === "qwen_body") continue
      return deltas
    }
    return deltas
  }
  return deltas
}

function consumeLiveQwenJsonToolCall(state: LiveStreamTranslationState): LiveToolCallDelta[] {
  const endMarker = "</tool_call>"
  const endIndex = state.pending.indexOf(endMarker)
  if (endIndex < 0) return []
  const raw = state.pending.slice(0, endIndex).trim()
  state.pending = state.pending.slice(endIndex + endMarker.length)
  const data = parseObject(raw)
  const name = stringOption(data.name) ?? "unknown"
  state.emittedArgumentPrefix = true
  state.nativeState = "done"
  return [
    startLiveToolCall(state, name, stringOption(data.id)),
    argumentsLiveDelta(state, JSON.stringify(normalizeToolArguments(name, parseObject(data.arguments ?? {})))),
  ]
}

function consumeLiveMiniMax(state: LiveStreamTranslationState): LiveToolCallDelta[] {
  const deltas: LiveToolCallDelta[] = []
  while (state.pending) {
    if (state.nativeState === "done") {
      if (beginNextLiveToolCall(state, "minimax")) continue
      return deltas
    }
    if (state.nativeState === "minimax_invoke") {
      const invoke = /<invoke\s+name=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|(?<bare>[^\s>]+))\s*>/s.exec(state.pending)
      const name = invoke?.groups?.double ?? invoke?.groups?.single ?? invoke?.groups?.bare
      if (!invoke || !name) return deltas
      state.pending = state.pending.slice(invoke.index + invoke[0].length)
      deltas.push(startLiveToolCall(state, name.trim()))
      state.nativeState = "minimax_body"
      continue
    }
    if (state.nativeState === "minimax_body") {
      const parameterMatch =
        /<parameter\s+name=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|(?<bare>[^\s>]+))\s*>/s.exec(state.pending)
      const parameterName =
        parameterMatch?.groups?.double ?? parameterMatch?.groups?.single ?? parameterMatch?.groups?.bare
      const invokeEnd = state.pending.indexOf("</invoke>")
      if (parameterMatch && parameterName && (invokeEnd < 0 || parameterMatch.index < invokeEnd)) {
        state.pending = state.pending.slice(parameterMatch.index + parameterMatch[0].length)
        beginLiveParameter(state, parameterName.trim())
        state.nativeState = "minimax_parameter"
        continue
      }
      if (invokeEnd >= 0) {
        deltas.push(...finishLiveArgumentObject(state))
        state.pending = state.pending.slice(invokeEnd + "</invoke>".length)
        consumeOptionalLiveSuffix(state, "</minimax:tool_call>")
        state.nativeState = "done"
        continue
      }
      return deltas
    }
    if (state.nativeState === "minimax_parameter") {
      deltas.push(...consumeLiveParameterValue(state, "minimax", "</parameter>"))
      if ((state as LiveStreamTranslationState).nativeState === "minimax_body") continue
      return deltas
    }
    return deltas
  }
  return deltas
}

function consumeLiveParameterValue(state: LiveStreamTranslationState, style: ToolCallStyle, endMarker: string) {
  const deltas: LiveToolCallDelta[] = []
  const endIndex = state.pending.indexOf(endMarker)
  if (endIndex >= 0) {
    const valueDelta = state.pending.slice(0, endIndex)
    state.pending = state.pending.slice(endIndex + endMarker.length)
    deltas.push(...parameterValueLiveDelta(state, valueDelta, true))
    endLiveParameter(state)
    state.nativeState = style === "minimax" ? "minimax_body" : "qwen_body"
    return deltas
  }
  const safeLength = liveSafeFlushLength(state.pending, endMarker)
  if (safeLength > 0) {
    const valueDelta = state.pending.slice(0, safeLength)
    state.pending = state.pending.slice(safeLength)
    deltas.push(...parameterValueLiveDelta(state, valueDelta, false))
  }
  return deltas
}

function parameterValueLiveDelta(state: LiveStreamTranslationState, valueDelta: string, isFinal: boolean) {
  const deltas: LiveToolCallDelta[] = []
  if (valueDelta) state.activeParameterBuffer += valueDelta
  if (shouldPreserveParameterText(state.activeToolName ?? "", state.activeParameterName ?? "")) {
    if (!isFinal) return deltas
    return [
      argumentsLiveDelta(
        state,
        liveParameterJsonPrefix(state) +
          JSON.stringify(parseToolParameter(state.activeToolName ?? "", state.activeParameterName ?? "", state.activeParameterBuffer)),
      ),
    ]
  }
  if (state.activeParameterStreamingString) {
    if (valueDelta) deltas.push(argumentsLiveDelta(state, jsonStringFragment(valueDelta)))
    if (isFinal) deltas.push(argumentsLiveDelta(state, '"'))
    return deltas
  }
  const stripped = state.activeParameterBuffer.trimStart()
  if (!stripped && !isFinal) return deltas
  if (!isFinal && shouldStreamAsString(state, stripped)) {
    state.activeParameterStreamingString = true
    return [argumentsLiveDelta(state, liveParameterJsonPrefix(state) + '"' + jsonStringFragment(state.activeParameterBuffer))]
  }
  if (!isFinal) return deltas
  return [
    argumentsLiveDelta(
      state,
      liveParameterJsonPrefix(state) +
        JSON.stringify(
          parseToolParameter(state.activeToolName ?? "", state.activeParameterName ?? "", state.activeParameterBuffer),
        ),
    ),
  ]
}

function beginLiveParameter(state: LiveStreamTranslationState, name: string) {
  state.activeParameterName = name
  state.activeParameterBuffer = ""
  state.activeParameterStreamingString = false
}

function endLiveParameter(state: LiveStreamTranslationState) {
  state.activeParameterName = undefined
  state.activeParameterBuffer = ""
  state.activeParameterStreamingString = false
}

function liveParameterJsonPrefix(state: LiveStreamTranslationState) {
  const prefix = state.emittedArgumentPrefix ? "," : "{"
  state.emittedArgumentPrefix = true
  return prefix + JSON.stringify(state.activeParameterName ?? "") + ":"
}

function finishLiveArgumentObject(state: LiveStreamTranslationState) {
  if (!state.emittedArgumentPrefix) {
    state.emittedArgumentPrefix = true
    return [argumentsLiveDelta(state, "{}")]
  }
  return [argumentsLiveDelta(state, "}")]
}

function startLiveToolCall(state: LiveStreamTranslationState, name: string, callID?: string): LiveToolCallDelta {
  state.toolStarted = true
  state.activeToolName = name
  state.activeToolCallID = callID
  return {
    index: state.toolIndex,
    id: callID ?? id("call"),
    type: "function",
    function: { name, arguments: "" },
  }
}

function beginNextLiveToolCall(state: LiveStreamTranslationState, style: ToolCallStyle) {
  const marker = toolMarker(style)
  let pending = state.pending.trimStart()
  if (style === "kimi") {
    if (pending.startsWith("<|tool_calls_section_end|>")) {
      pending = pending.slice("<|tool_calls_section_end|>".length).trimStart()
      if (!pending.startsWith(marker)) {
        state.pending = pending
        return false
      }
    }
    if (pending.startsWith(marker)) pending = pending.slice(marker.length).trimStart()
    if (!pending.startsWith("<|tool_call_begin|>")) {
      state.pending = pending
      return false
    }
    state.pending = pending
  } else {
    if (!pending.startsWith(marker)) {
      state.pending = pending
      return false
    }
    state.pending = pending.slice(marker.length)
  }
  resetLiveToolCallState(state)
  state.nativeState = initialNativeState(style)
  return true
}

function resetLiveToolCallState(state: LiveStreamTranslationState) {
  state.toolIndex++
  state.emittedArgumentPrefix = false
  state.activeParameterName = undefined
  state.activeParameterBuffer = ""
  state.activeParameterStreamingString = false
  state.activeToolName = undefined
  state.activeToolCallID = undefined
}

function argumentsLiveDelta(state: LiveStreamTranslationState, argumentsDelta: string): LiveToolCallDelta {
  return { index: state.toolIndex, function: { arguments: argumentsDelta } }
}

function flushLiveSafeContent(state: LiveStreamTranslationState, marker: string) {
  const safeLength = liveSafeFlushLength(state.pending, marker)
  if (safeLength <= 0) return
  return flushLiveContent(state, safeLength)
}

function flushLiveContent(state: LiveStreamTranslationState, length: number) {
  const content = state.pending.slice(0, length)
  state.pending = state.pending.slice(length)
  if (!content) return
  state.sentContent += content
  return content
}

function liveSafeFlushLength(text: string, marker: string) {
  return Math.max(0, text.length - Math.min(text.length, Math.max(marker.length, MAX_TOOL_MARKER_KEEP_LENGTH) - 1))
}

function consumeOptionalKimiSectionEnd(state: LiveStreamTranslationState) {
  if (state.pending.startsWith("<|tool_calls_section_end|>")) {
    state.pending = state.pending.slice("<|tool_calls_section_end|>".length)
  }
}

function consumeOptionalLiveSuffix(state: LiveStreamTranslationState, marker: string) {
  const pending = state.pending.trimStart()
  if (pending.startsWith(marker)) state.pending = pending.slice(marker.length)
}

function initialNativeState(style: ToolCallStyle) {
  if (style === "kimi") return "kimi_header"
  if (style === "minimax") return "minimax_invoke"
  return "qwen_function"
}

function toolMarker(style: ToolCallStyle) {
  if (style === "kimi") return "<|tool_calls_section_begin|>"
  if (style === "minimax") return "<minimax:tool_call>"
  return "<tool_call>"
}

function shouldStreamAsString(state: LiveStreamTranslationState, value: string) {
  if (shouldPreserveParameterText(state.activeToolName ?? "", state.activeParameterName ?? "")) return true
  return (
    !["{", "[", '"', "-", "+"].some((prefix) => value.startsWith(prefix)) &&
    !["true", "false", "null"].some((prefix) => value.startsWith(prefix)) &&
    !/^\d/.test(value)
  )
}

function jsonStringFragment(value: string) {
  const encoded = JSON.stringify(value)
  return encoded.slice(1, -1)
}

function pushStreamText(state: StreamTranslationState, text: string) {
  state.pending += text
  if (state.bufferingTool) return

  const span = firstToolMarkerSpan(state.pending)
  if (span) {
    state.bufferingTool = true
    return flushStreamText(state, span.contentLength)
  }

  const safeLength = Math.max(0, state.pending.length - Math.min(state.pending.length, MAX_TOOL_MARKER_KEEP_LENGTH - 1))
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

function firstToolMarkerSpan(text: string) {
  const spans = TOOL_MARKERS.map((marker) => toolMarkerSpan(text, marker)).filter(
    (span): span is ToolMarkerSpan => Boolean(span),
  )
  if (!spans.length) return
  return spans.reduce((first, span) => (span.consumeLength < first.consumeLength ? span : first))
}

function toolMarkerSpan(text: string, marker: string): ToolMarkerSpan | undefined {
  const markerIndex = text.indexOf(marker)
  if (markerIndex < 0) return
  const beforeMarker = text.slice(0, markerIndex)
  const label = /(?:^|\n)[ \t]*tool_call:\s*$/i.exec(beforeMarker)
  return {
    contentLength: label?.index ?? markerIndex,
    consumeLength: markerIndex + marker.length,
  }
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

async function buildRequestMetadata(
  request: ChatRequest,
  provider: Info,
  model: Model,
  signal: AbortSignal | undefined,
): Promise<RequestMetadata> {
  const metadata: RequestMetadata = { ...(request.metadata ?? {}) }
  delete metadata.image_uploads
  const uploads = await collectImageUploads(
    request.messages ?? [],
    numberOption(model.options.maxUploadImages) ?? numberOption(provider.options.maxUploadImages) ?? 1,
    numberOption(model.options.maxUploadImageBytes) ??
      numberOption(provider.options.maxUploadImageBytes) ??
      10 * 1024 * 1024,
    numberOption(model.options.maxUploadImageDownloadMs) ??
      numberOption(provider.options.maxUploadImageDownloadMs) ??
      30_000,
    signal,
  )
  if (uploads.length) metadata.image_uploads = uploads
  return metadata
}

async function collectImageUploads(
  messages: ChatMessage[],
  maxImages: number,
  maxImageBytes: number,
  maxImageDownloadMs: number,
  signal: AbortSignal | undefined,
) {
  const urls = messages.flatMap((message) => imageURLs(message.content))
  if (urls.length > maxImages)
    throw new CompanyTxtRequestError(`company-txt supports at most ${maxImages} image input(s)`, { param: "messages" })
  return Promise.all(urls.map((url, index) => imageUpload(url, index + 1, maxImageBytes, maxImageDownloadMs, signal)))
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

async function imageUpload(
  url: string,
  index: number,
  maxBytes: number,
  maxDownloadMs: number,
  signal: AbortSignal | undefined,
): Promise<ImageUpload> {
  if (url.startsWith("data:")) return dataURLImageUpload(url, index, maxBytes)
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new CompanyTxtRequestError("company-txt only supports data:image/...;base64 and http(s) image URLs", {
      param: "messages",
    })
  }
  const abort = imageDownloadAbort(signal, maxDownloadMs)
  try {
    const response = await fetch(url, { signal: abort.signal })
    if (!response.ok) throw new Error(`company-txt failed to download image: ${response.status}`)
    const contentLength = responseContentLength(response)
    if (contentLength !== undefined) validateImageBytes(contentLength, maxBytes)
    const contentType = (response.headers.get("content-type") ?? "image/png").split(";")[0]!.trim()
    if (!contentType.startsWith("image/"))
      throw new CompanyTxtRequestError(`company-txt image URL returned ${contentType}`, { param: "messages" })
    const content = new Uint8Array(await response.arrayBuffer())
    validateImageBytes(content.length, maxBytes)
    return { filename: filenameFromURL(url, contentType, index), content, contentType }
  } catch (error) {
    if (abort.timedOut()) {
      throw new CompanyTxtRequestError(`company-txt image download timed out after ${maxDownloadMs}ms`, {
        param: "messages",
      })
    }
    throw error
  } finally {
    abort.cleanup()
  }
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
  const base64 = normalizeBase64Payload(payload, maxBytes)
  const content = new Uint8Array(Buffer.from(base64, "base64"))
  validateImageBytes(content.length, maxBytes)
  return { filename: `image_${index}${extensionForContentType(contentType)}`, content, contentType }
}

function imageDownloadAbort(signal: AbortSignal | undefined, maxDownloadMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const timeout =
    maxDownloadMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, maxDownloadMs)
      : undefined
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener("abort", abort, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    },
  }
}

function normalizeBase64Payload(payload: string, maxBytes: number) {
  const normalized = payload.replace(/\s/g, "")
  validateImageBytes(estimatedBase64Bytes(normalized), maxBytes)
  return normalized
}

function estimatedBase64Bytes(input: string) {
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((input.length * 3) / 4) - padding)
}

function responseContentLength(response: Response) {
  const value = response.headers.get("content-length")
  if (!value) return
  const size = Number(value)
  return Number.isFinite(size) && size >= 0 ? size : undefined
}

function validateImageBytes(size: number, maxBytes: number) {
  if (size > maxBytes)
    throw new CompanyTxtRequestError(`company-txt image input is too large: ${size} > ${maxBytes}`, {
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

function applyLiveToolCallPolicy(toolCalls: LiveToolCallDelta[], request: ChatRequest) {
  if (request.parallel_tool_calls === false) return toolCalls.filter((toolCall) => toolCall.index === 0)
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

function parseToolParameter(toolName: string, parameterName: string, value: string): unknown {
  if (shouldPreserveParameterText(toolName, parameterName)) return unwrapToolParameterText(value)
  return parseParameter(value.trim())
}

function normalizeToolArguments(toolName: string, args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([parameterName, value]) => [
      parameterName,
      shouldPreserveParameterText(toolName, parameterName) && typeof value !== "string"
        ? JSON.stringify(value, null, 2)
        : value,
    ]),
  )
}

function shouldPreserveParameterText(toolName: string, parameterName: string) {
  if (!TEXT_FILE_CONTENT_PARAMETERS.has(parameterName)) return false
  return toolName === "write" || toolName === "edit"
}

function unwrapToolParameterText(value: string) {
  const withoutLeading = value.startsWith("\r\n")
    ? value.slice(2)
    : value.startsWith("\n")
      ? value.slice(1)
      : value
  if (withoutLeading.endsWith("\r\n")) return withoutLeading.slice(0, -2)
  if (withoutLeading.endsWith("\n")) return withoutLeading.slice(0, -1)
  return withoutLeading
}

function parseObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) return input
  return parseJson(String(input), {})
}

function parseStrictObject(input: string, context: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown
    if (isRecord(parsed)) return parsed
    throw new Error("expected JSON object")
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON"
    throw new Error(`${context}: ${message}; raw_args_preview=${JSON.stringify(input.slice(0, 500))}`)
  }
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

function contentOption(input: unknown) {
  return typeof input === "string" ? input : undefined
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
