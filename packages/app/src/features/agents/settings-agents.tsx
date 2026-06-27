import { createEffect, createMemo, createResource, createSignal, Show, ErrorBoundary } from "solid-js"
import { useParams, useSearchParams } from "@solidjs/router"
import { useQueryClient } from "@tanstack/solid-query"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { decode64 } from "@/utils/base64"
import { pathKey } from "@/utils/path-key"
import type { AgentSource, AgentFormData } from "./types"
import { isBuiltinAgent } from "./types"
import { createAgentService, type AgentService, type ServerAuth } from "./agent-service"
import { AgentList } from "./list"
import { AgentDetail } from "./detail"
import { AgentEditor } from "./editor"
import { DeleteAgentDialog } from "./delete-dialog"

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
  const queryClient = useQueryClient()
  const params = useParams<{ dir?: string }>()
  const [searchParams] = useSearchParams<{ project?: string }>()

  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal("")
  const [sourceFilter, setSourceFilter] = createSignal<AgentSource | "all">("all")
  const [mode, setMode] = createSignal<"view" | "create" | "edit">("view")
  const [editorInitialData, setEditorInitialData] = createSignal<Partial<AgentFormData> | undefined>()

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

  const [data, { refetch }] = createResource(
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
    if (isBuiltinAgent(agentName)) return "built-in"
    return sources().get(agentName) ?? "project"
  }
  const sourceOrder: Record<AgentSource, number> = {
    project: 0,
    global: 1,
    "built-in": 2,
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
      "built-in": list.filter((agent) => isBuiltinAgent(agent.name)).length,
      project: list.filter((agent) => !isBuiltinAgent(agent.name) && (sources().get(agent.name) ?? "project") === "project").length,
      global: list.filter((agent) => !isBuiltinAgent(agent.name) && sources().get(agent.name) === "global").length,
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
    if (isBuiltinAgent(agent.name)) return "built-in"
    return sources().get(agent.name) ?? "project"
  }

  const refreshAgents = async () => {
    const svc = service()
    if (!svc) return
    await svc.disposeInstance()
    await queryClient.refetchQueries({
      queryKey: [serverSDK().scope, pathKey(directory() ?? ""), "agents"],
      exact: true,
    })
    await refetch()
  }

  const refreshAfterMutation = async () => {
    try {
      await refreshAgents()
      return true
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

  const cancelEdit = () => {
    setMode("view")
  }

  const handleEdit = async (id: string) => {
    const svc = service()
    if (!svc) return
    try {
      const source = sources().get(id) ?? "project"
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
    try {
      if (mode === "create") {
        await svc.createAgent(formData)
      } else {
        await svc.updateAgent(formData.name, formData)
      }
    } catch (err) {
      showToast({ variant: "error", title: "保存失败", description: err instanceof Error ? err.message : String(err) })
      return
    }

    const synced = await refreshAfterMutation()
    setSelectedId(formData.name)
    setEditorInitialData(undefined)
    setMode("view")
    showToast({
      variant: synced ? "success" : "error",
      title: synced ? (mode === "create" ? "创建成功" : "更新成功") : "已保存，但同步失败",
      description: synced
        ? `智能体「${formData.name}」已${mode === "create" ? "创建" : "更新"}并同步生效。`
        : "请重新打开当前项目以加载最新智能体配置。",
    })
  }

  const handleDeleteClick = (id: string) => {
    const source = sources().get(id) ?? "project"
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

  const handleDeleteConfirm = async (id: string, source: string) => {
    const svc = service()
    if (!svc) return
    try {
      await svc.deleteAgent(id, source)
      if (selectedId() === id) setSelectedId(null)
      const synced = await refreshAfterMutation()
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
            <h1 class="text-[16px] font-[530] leading-8 text-[var(--v2-text-text-base)]">{language.t("agents.title")}</h1>
          </div>
          <button
            type="button"
            onClick={handleNew}
            class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
          >
            新建智能体
          </button>
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
                  directory={directory()}
                  onEdit={() => selectedAgent() && handleEdit(selectedAgent()!.name)}
                  onDelete={() => selectedAgent() && handleDeleteClick(selectedAgent()!.name)}
                  onDuplicate={() => selectedAgent() && handleDuplicate(selectedAgent()!.name)}
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
