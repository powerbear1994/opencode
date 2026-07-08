import { createEffect, createMemo, createResource, createSignal, Show, ErrorBoundary } from "solid-js"
import { useParams, useSearchParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { decode64 } from "@/utils/base64"
import type { AgentSource, AgentFormData } from "./types"
import { isBuiltinAgent } from "./types"
import { createAgentService, type AgentService, type ServerAuth } from "./agent-service"
import { AgentList } from "./list"
import { AgentDetail } from "./detail"
import { AgentEditor } from "./editor"
import { DeleteAgentDialog } from "./delete-dialog"

const MIN_SMART_DESCRIPTION_LENGTH = 20
type AgentListResult = Awaited<ReturnType<AgentService["listAgents"]>>

// ── Error fallback ─────────────────────────────────────────────────────────────

function ErrorFallback(err: Error, reset: () => void) {
  return (
    <div class="flex flex-col items-center gap-3 py-8">
      <p class="text-[13px] text-[var(--v2-text-text-muted)]">加载智能体失败：{err.message}</p>
      <button
        type="button"
        onClick={reset}
        class="px-3 py-1.5 rounded-[6px] text-[13px] bg-[var(--v2-background-bg-layer-01)] text-[var(--v2-text-text-base)] hover:bg-[var(--v2-background-bg-layer-02)] transition-colors"
      >
        重试
      </button>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

const AgentsContent = () => {
  const server = useServer()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const dialogFn = useDialog()
  const params = useParams<{ dir?: string }>()
  const [searchParams] = useSearchParams<{ project?: string }>()

  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal("")
  const [sourceFilter, setSourceFilter] = createSignal<AgentSource | "all">("all")
  const [mode, setMode] = createSignal<"view" | "create" | "edit">("view")
  const [editorInitialData, setEditorInitialData] = createSignal<Partial<AgentFormData> | undefined>()
  const [smartName, setSmartName] = createSignal("")
  const [smartDescription, setSmartDescription] = createSignal("")
  const [smartGenerating, setSmartGenerating] = createSignal(false)
  const [smartError, setSmartError] = createSignal<string>()

  // Workflow pages keep the active project in the query string because they have no directory route segment.
  const directory = createMemo(() => {
    if (params.dir) return decode64(params.dir) ?? ""
    return searchParams.project ?? ""
  })

  const hasProject = () => (directory() ?? "").length > 0

  const serverAuth = (): ServerAuth => {
    const conn = server.current
    if (!conn) return { url: "" }
    return { url: conn.http.url, username: conn.http.username, password: conn.http.password }
  }

  // ── Service ──────────────────────────────────────────────────────────────

  const [service, setService] = createSignal<AgentService | null>(null)

  createEffect(() => {
    const auth = serverAuth()
    if (auth.url) setService(createAgentService(auth, directory()))
  })

  // ── Data ─────────────────────────────────────────────────────────────────

  const [data, { refetch, mutate }] = createResource(
    () => service(),
    async (svc) => svc.listAgents(),
  )

  createEffect(() => {
    if (hasProject()) return
    if (sourceFilter() === "project") setSourceFilter("all")
  })

  const agents = () => {
    const val = data()
    if (!val || !Array.isArray(val.agents)) return []
    return val.agents
  }
  const sources = () => {
    const val = data()
    if (!val || !(val.sources instanceof Map)) return new Map<string, AgentSource>()
    return val.sources
  }
  const agentSource = (agentName: string): AgentSource => {
    return sources().get(agentName) ?? "unknown"
  }
  const sourceOrder: Record<AgentSource, number> = {
    project: 0,
    global: 1,
    "project-config": 2,
    "global-config": 3,
    "built-in": 4,
    unknown: 5,
  }
  const orderedAgents = createMemo(() =>
    agents()
      .slice()
      .sort((a, b) => sourceOrder[agentSource(a.name)] - sourceOrder[agentSource(b.name)] || a.name.localeCompare(b.name)),
  )
  const counts = createMemo(() => {
    const list = agents()
    return {
      all: list.length,
      "built-in": list.filter((agent) => agentSource(agent.name) === "built-in").length,
      project: list.filter((agent) => agentSource(agent.name) === "project").length,
      global: list.filter((agent) => agentSource(agent.name) === "global").length,
      "project-config": list.filter((agent) => agentSource(agent.name) === "project-config").length,
      "global-config": list.filter((agent) => agentSource(agent.name) === "global-config").length,
      unknown: list.filter((agent) => agentSource(agent.name) === "unknown").length,
    }
  })

  createEffect(() => {
    if (mode() !== "view") return
    const current = selectedId()
    const list = orderedAgents()
    if (current && list.some((agent) => agent.name === current)) return
    setSelectedId(list[0]?.name ?? null)
  })

  const selectedAgent = createMemo(() => {
    const id = selectedId()
    return (id ? agents().find((agent) => agent.name === id) : undefined) ?? orderedAgents()[0] ?? null
  })

  const selectedSource = (): AgentSource => {
    const agent = selectedAgent()
    if (!agent) return "built-in"
    return agentSource(agent.name)
  }
  const [selectedSourcePath] = createResource(
    () => {
      const svc = service()
      const agent = selectedAgent()
      if (!svc || !agent) return
      const source = selectedSource()
      if (source === "built-in" || source === "unknown") return
      return { svc, id: agent.name, source }
    },
    async (input) => {
      const file = await input.svc.readAgentFile(input.id, input.source)
      return file.path
    },
  )

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const customCount = (value: AgentListResult | null | undefined, removedName?: string) =>
    value?.agents.filter((agent) => agent.name !== removedName && !isBuiltinAgent(agent.name)).length ?? 0

  const withoutAgent = (value: AgentListResult | null | undefined, id: string) => {
    if (!value) return
    const nextSources = new Map(value.sources)
    nextSources.delete(id)
    return {
      ...value,
      agents: value.agents.filter((agent) => agent.name !== id),
      sources: nextSources,
    }
  }

  const refreshReady = (
    value: AgentListResult | null | undefined,
    options: { expectedName?: string; removedName?: string; fallback?: AgentListResult },
  ) => {
    if (!value) return false
    if (options.expectedName && !value.agents.some((agent) => agent.name === options.expectedName)) return false
    if (
      options.removedName &&
      value.agents.some((agent) => agent.name === options.removedName) &&
      value.sources.get(options.removedName) !== "built-in"
    ) return false
    if (customCount(value) < customCount(options.fallback, options.removedName)) return false
    return true
  }

  const refreshAgents = async (options: { expectedName?: string; removedName?: string; fallback?: AgentListResult } = {}) => {
    const first = await refetch()
    if (refreshReady(first, options)) return true
    // 一次快速重试，处理服务端写入延迟
    await delay(150)
    const second = await refetch()
    return refreshReady(second, options)
  }

  const refreshAfterMutation = async (options: { expectedName?: string; removedName?: string; fallback?: AgentListResult } = {}) => {
    try {
      return await refreshAgents(options)
    } catch (err) {
      console.error("[agents] Failed to refresh agent data after mutation", err)
      return false
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleNew = () => {
    setSelectedId(null)
    setEditorInitialData(undefined)
    setMode("create")
  }

  const startSmartCreate = () => {
    setSmartName("")
    setSmartDescription("")
    setSmartError(undefined)
    setSmartGenerating(false)
    dialogFn.push(() => <SmartCreateDialog />)
  }

  const smartCreate = async () => {
    const svc = service()
    const name = smartName().trim()
    const description = smartDescription().trim()
    if (!svc) return
    if (!name) {
      setSmartError("请输入智能体名称。")
      return
    }
    if (description.length < MIN_SMART_DESCRIPTION_LENGTH) {
      setSmartError(`智能体需求至少需要 ${MIN_SMART_DESCRIPTION_LENGTH} 个字符。`)
      return
    }
    setSmartGenerating(true)
    setSmartError(undefined)
    try {
      const generated = await svc.generateAgent({ name, description })
      setSelectedId(null)
      setEditorInitialData({
        name: generated.name || name,
        location: hasProject() ? "project" : "global",
        description: generated.description,
        mode: generated.mode,
        prompt: generated.prompt,
      })
      dialogFn.close()
      setMode("create")
    } catch (err) {
      setSmartError(err instanceof Error ? err.message : String(err))
    } finally {
      setSmartGenerating(false)
    }
  }

  const cancelEdit = () => {
    setMode("view")
  }

  const handleEdit = async (id: string) => {
    const svc = service()
    if (!svc) return
    try {
      const source = sources().get(id) ?? "unknown"
      if (source !== "project" && source !== "global") return
      const file = await svc.readAgentFile(id, source)
      const formData: Partial<AgentFormData> = {
        name: id,
        location: source as "project" | "global",
        description: (file.frontmatter.description as string) || "",
        mode: (file.frontmatter.mode as "subagent" | "primary" | "all") || "all",
        model: (file.frontmatter.model as string) || "",
        temperature: (file.frontmatter.temperature as number) || 0,
        color: (file.frontmatter.color as string) || "",
        hidden: (file.frontmatter.hidden as boolean) ?? false,
        disable: (file.frontmatter.disable as boolean) ?? false,
        prompt: file.body || "",
        permissions: [],
      }
      const perms = file.frontmatter.permission as Record<string, unknown> | undefined
      if (perms) {
        formData.permissions = Object.entries(perms).flatMap(([tool, action]) =>
          action === "allow" || action === "ask" || action === "deny" ? [{ tool, action }] : [],
        )
      }
      setEditorInitialData(formData)
      setMode("edit")
    } catch (err) {
      showToast({
        variant: "error",
        title: "读取失败",
        description: `无法读取智能体文件：${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  const handleDuplicate = (id: string) => {
    const agent = agents().find((a) => a.name === id)
    if (!agent) return
    const formData: Partial<AgentFormData> = {
      name: `${agent.name}-copy`,
      location: "project",
      mode: agent.mode,
      description: agent.description || "",
      model: agent.model ? `${agent.model.providerID}/${agent.model.modelID}` : "",
      temperature: agent.temperature || 0,
      color: agent.color || "",
      hidden: agent.hidden ?? false,
      disable: false,
      prompt: agent.prompt || "",
    }
    setSelectedId(null)
    setEditorInitialData(formData)
    setMode("create")
  }

  const handleSave = async (formData: AgentFormData, mode: "create" | "edit") => {
    const svc = service()
    if (!svc) return
    let savedName = formData.name
    try {
      if (mode === "create") {
        savedName = (await svc.createAgent(formData)).name
      } else {
        savedName = (await svc.updateAgent(formData.name, formData)).name
      }
    } catch (err) {
      showToast({ variant: "error", title: "保存失败", description: err instanceof Error ? err.message : String(err) })
      return
    }

    const synced = await refreshAfterMutation({ expectedName: savedName })
    setSelectedId(savedName)
    setEditorInitialData(undefined)
    setMode("view")
    showToast({
      variant: synced ? "success" : "error",
      title: synced ? (mode === "create" ? "创建成功" : "更新成功") : "已保存，但同步失败",
      description: synced
        ? `智能体「${savedName}」已${mode === "create" ? "创建" : "更新"}并同步生效。`
        : "请重新打开当前项目以加载最新智能体配置。",
    })
  }

  function SmartCreateDialog() {
    return (
      <Dialog title="智能生成智能体" size="x-large">
        <div class="flex flex-col gap-6 px-2 pb-2 pt-1">
          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3">
            <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">AI 智能生成</p>
            <p class="mt-0.5 text-[12px] leading-relaxed text-[var(--v2-text-text-muted)]">
              输入名称和智能体需求，AI 会生成简介、模式和系统提示词，并填充到创建表单中
            </p>
          </div>

          <div class="flex flex-col gap-4">
            <Show when={smartGenerating()}>
              <div class="flex flex-col items-center gap-3 rounded-[8px] border border-[var(--v2-blue-400)]/20 bg-[var(--v2-blue-400)]/4 px-4 py-6">
                <span class="inline-flex gap-1">
                  <span class="size-2 animate-pulse rounded-full bg-[var(--v2-blue-400)]" style="animation-delay:0ms" />
                  <span class="size-2 animate-pulse rounded-full bg-[var(--v2-blue-400)]" style="animation-delay:200ms" />
                  <span class="size-2 animate-pulse rounded-full bg-[var(--v2-blue-400)]" style="animation-delay:400ms" />
                </span>
                <div class="text-center">
                  <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">AI 正在生成智能体</p>
                  <p class="mt-1 text-[12px] text-[var(--v2-text-text-muted)]">正在调用模型生成智能体草稿，请稍候</p>
                </div>
              </div>
            </Show>

            <Show when={!smartGenerating()}>
              <label class="flex flex-col gap-1.5">
                <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">
                  名称
                  <span class="ml-0.5 text-[var(--v2-red-400)]">*</span>
                </span>
                <input
                  autofocus
                  value={smartName()}
                  onInput={(event) => setSmartName(event.currentTarget.value)}
                  placeholder="例如：design-agent"
                  disabled={smartGenerating()}
                  class="h-8 min-w-0 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 text-[13px] text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
                />
              </label>

              <label class="flex flex-col gap-1.5">
                <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">
                  智能体需求
                  <span class="ml-0.5 text-[var(--v2-red-400)]">*</span>
                </span>
                <textarea
                  value={smartDescription()}
                  onInput={(event) => setSmartDescription(event.currentTarget.value)}
                  placeholder="描述这个智能体的职责、调用场景、工作边界和输出要求"
                  disabled={smartGenerating()}
                  rows={4}
                  class="min-h-[80px] resize-none rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 py-2 text-[13px] leading-relaxed text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
                />
                <span class="text-[11px] text-[var(--v2-text-text-faint)]">
                  至少 {MIN_SMART_DESCRIPTION_LENGTH} 个字符
                </span>
              </label>
            </Show>
          </div>

          <Show when={smartError()}>
            <div class="rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 py-2 text-[12px] text-[var(--v2-text-text-base)]">
              {smartError()}
            </div>
          </Show>

          <div class="flex items-center justify-end gap-2.5 border-t border-[var(--v2-border-border-base)] pt-5">
            <button
              type="button"
              onClick={() => dialogFn.close()}
              disabled={smartGenerating()}
              class="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={smartCreate}
              disabled={smartGenerating() || !smartName().trim() || smartDescription().trim().length < MIN_SMART_DESCRIPTION_LENGTH}
              class="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-blue-400)]/45 bg-[var(--v2-blue-400)]/12 px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-blue-400)]/18 disabled:opacity-50"
            >
              {smartGenerating() ? "正在生成" : "生成"}
            </button>
          </div>
        </div>
      </Dialog>
    )
  }

  const handleDeleteClick = (id: string) => {
    const source = sources().get(id) ?? "unknown"
    if (source !== "project" && source !== "global") return
    dialogFn.push(() => (
      <DeleteAgentDialog
        agentName={id}
        onConfirm={async () => {
          await handleDeleteConfirm(id, source)
          dialogFn.close()
        }}
      />
    ))
  }

  const handleCopyPath = async (id: string) => {
    const svc = service()
    const source = selectedSource()
    if (!svc || source === "built-in" || source === "unknown") return
    try {
      const file = await svc.readAgentFile(id, source)
      await navigator.clipboard.writeText(file.path)
    } catch (err) {
      showToast({
        variant: "error",
        title: "复制失败",
        description: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  const handleDeleteConfirm = async (id: string, source: string) => {
    const svc = service()
    if (!svc) return
    const beforeDelete = data()
    const optimistic = withoutAgent(beforeDelete, id)
    try {
      await svc.deleteAgent(id, source)
      if (optimistic) mutate(optimistic)
      if (selectedId() === id) setSelectedId(null)
      const synced = await refreshAfterMutation({ removedName: id, fallback: beforeDelete })
      if (!synced && optimistic) mutate(optimistic)
      showToast({
        variant: synced ? "success" : "error",
        title: synced ? "删除成功" : "已删除，但同步失败",
        description: synced ? `智能体「${id}」已删除并同步生效。` : "请重新打开当前项目以刷新智能体列表。",
      })
    } catch (err) {
      showToast({ variant: "error", title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      {/* Title + project context */}
      <div class="shrink-0 border-b border-[var(--v2-border-border-base)] px-5 pb-3 pt-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div>
              <h1 class="text-[16px] font-[530] leading-8 text-[var(--v2-text-text-base)]">{language.t("agents.title")}</h1>
              <p class="text-[12px] leading-5 text-[var(--v2-text-text-muted)]">管理当前项目与全局可用的智能体配置</p>
            </div>
          </div>
          <Show when={mode() === "view"}>
            <button
              type="button"
              onClick={handleNew}
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
            >
              新建智能体
            </button>
          </Show>
        </div>
      </div>

      {/* Body */}
      <div class="flex min-h-0 flex-1">
        {/* Left: list — hidden during create to give editor full width */}
        <div
          class="flex h-full w-full shrink-0 flex-col border-r border-[var(--v2-border-border-base)] md:w-[360px] md:max-w-[360px]"
          classList={{ hidden: mode() === "create" }}
        >
          <AgentList
            agents={agents()}
            sources={sources()}
            counts={counts()}
            selectedId={selectedId() ?? selectedAgent()?.name ?? null}
            loading={data.loading}
            error={data.error ? String(data.error) : null}
            search={search()}
            sourceFilter={sourceFilter()}
            hasProject={hasProject()}
            onSearchChange={setSearch}
            onSourceFilterChange={setSourceFilter}
            onSelect={(id) => {
              setMode("view")
              setEditorInitialData(undefined)
              setSelectedId(id)
            }}
            onRefresh={refetch}
          />
        </div>

        {/* Right: detail */}
        <div class="flex min-h-0 min-w-0 flex-1">
          <Show
            when={mode() === "create" || mode() === "edit"}
            fallback={
              <Show
                when={selectedAgent()}
                fallback={
                  <div class="hidden h-full min-h-0 flex-1 items-center justify-center md:flex">
                    <span class="text-[13px] text-[var(--v2-text-text-muted)]">选择一个智能体查看详情</span>
                  </div>
                }
              >
                <AgentDetail
                  agent={selectedAgent()}
                  source={selectedSource()}
                  sourcePath={selectedSourcePath()}
                  onEdit={() => selectedAgent() && handleEdit(selectedAgent()!.name)}
                  onDelete={() => selectedAgent() && handleDeleteClick(selectedAgent()!.name)}
                  onDuplicate={() => selectedAgent() && handleDuplicate(selectedAgent()!.name)}
                  onCopyPath={() => selectedAgent() ? handleCopyPath(selectedAgent()!.name) : Promise.resolve()}
                />
              </Show>
            }
          >
            <AgentEditor
              title={mode() === "edit" ? "编辑智能体" : editorInitialData()?.name ? "复制为自定义智能体" : "新建智能体"}
              initialData={editorInitialData()}
              hideLocation={mode() === "edit"}
              nameLocked={mode() === "edit"}
              projectDir={directory()}
              hasProject={hasProject()}
              createAsSubagent={mode() === "create" && !editorInitialData()}
              variant="inline"
              onSmartGenerate={startSmartCreate}
              onCancel={cancelEdit}
              onSave={(formData) => handleSave(formData, mode() === "edit" ? "edit" : "create")}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function SettingsAgents() {
  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <AgentsContent />
    </ErrorBoundary>
  )
}
