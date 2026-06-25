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

  // Requirements keeps the active project in the query string because it has no directory route segment.
  const directory = createMemo(() => {
    if (params.dir) return decode64(params.dir) ?? ""
    return searchParams.project ?? ""
  })

  const hasProject = () => directory().length > 0

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

  const agents = () => data()?.agents ?? []
  const sources = () => data()?.sources ?? new Map<string, AgentSource>()

  const selectedAgent = () => {
    const id = selectedId()
    if (!id) return null
    return agents().find((a) => a.name === id) ?? null
  }

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
      queryKey: [serverSDK().scope, pathKey(directory()), "agents"],
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
    const projDir = directory()
    dialogFn.push(() => (
      <AgentEditor
        title="新建智能体"
        projectDir={projDir}
        hasProject={hasProject()}
        createAsSubagent
        onSave={async (formData) => {
          dialogFn.close()
          await handleSave(formData, "create")
        }}
      />
    ))
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
      dialogFn.push(() => (
        <AgentEditor
          title="编辑智能体"
          initialData={formData}
          hideLocation
          nameLocked
          projectDir={directory()}
          hasProject={hasProject()}
          onSave={async (fd) => {
            dialogFn.close()
            await handleSave(fd, "edit")
          }}
        />
      ))
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
    dialogFn.push(() => (
      <AgentEditor
        title="复制为自定义智能体"
        initialData={formData}
        projectDir={directory()}
        hasProject={hasProject()}
        onSave={async (fd) => {
          dialogFn.close()
          await handleSave(fd, "create")
        }}
      />
    ))
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

  // ── Project display helpers ──────────────────────────────────────────────

  const projectName = () => {
    const d = directory()
    if (!d) return ""
    return d.split("/").pop() || d
  }

  const projectAgentPath = () => (directory() ? `${directory()}/.opencode/agents` : "")
  const globalAgentPath = () => "~/.config/opencode/agents"

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div class="flex flex-col h-full min-h-0 w-full">
      {/* Title + project context */}
      <div class="shrink-0 flex items-center justify-between gap-4 px-5 pt-4 pb-3">
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)] shrink-0">{language.t("agents.title")}</h1>
        <Show
          when={hasProject()}
          fallback={
            <p class="text-[12px] text-[var(--v2-text-text-muted)] truncate">
              当前未打开项目，仅展示内置与全局智能体。
            </p>
          }
        >
          <p class="text-[12px] text-[var(--v2-text-text-muted)] truncate max-w-[480px]" title={directory()}>
            当前项目：<span class="text-[var(--v2-text-text-base)]">{projectName()}</span>
            <span class="text-[var(--v2-text-text-faint)] ml-1">· {directory()}</span>
          </p>
        </Show>
      </div>

      {/* Body */}
      <div class="flex-1 min-h-0 flex mt-2">
        {/* Left: list */}
        <div class="h-full min-h-0 w-full max-w-[270px] shrink-0 border-r border-[var(--v2-border-border-base)]">
          <AgentList
            agents={agents()}
            sources={sources()}
            selectedId={selectedId()}
            loading={data.loading}
            error={data.error ? String(data.error) : null}
            search={search()}
            sourceFilter={sourceFilter()}
            onSearchChange={setSearch}
            onSourceFilterChange={setSourceFilter}
            onSelect={setSelectedId}
            onNew={handleNew}
            onRefresh={refetch}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
            onDuplicate={handleDuplicate}
          />
        </div>

        {/* Right: detail */}
        <Show when={selectedId()}>
          <div class="flex-1 min-h-0 min-w-0">
            <AgentDetail
              agent={selectedAgent()}
              source={selectedSource()}
              directory={directory()}
              onEdit={() => handleEdit(selectedId()!)}
              onDelete={() => handleDeleteClick(selectedId()!)}
              onDuplicate={() => handleDuplicate(selectedId()!)}
            />
          </div>
        </Show>

        <Show when={!selectedId()}>
          <div class="flex-1 hidden xl:flex items-center justify-center min-h-0">
            <span class="text-[13px] text-[var(--v2-text-text-muted)]">选择一个智能体查看详情</span>
          </div>
        </Show>
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
