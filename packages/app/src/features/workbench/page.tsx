import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { PriorityBadge } from "@/features/requirements/badge"
import {
  buildDesignContent,
  buildDevelopmentContent,
  buildRawContent,
  buildTestContent,
  RequirementsProvider,
  useRequirements,
} from "@/features/requirements/provider"
import { resolveRequirementProject } from "@/features/requirements/project-context"
import {
  designDocumentPath,
  developmentDocumentPath,
  loadDesignDocument,
  loadDevelopmentDocument,
  loadRequirementDocument,
  loadTestDocument,
  requirementDocumentPath,
  saveRequirementDocument,
  testDocumentPath,
} from "@/features/requirements/services/requirementDocument"
import { useRequirementLinks } from "@/features/requirements/services/requirementLinkStore"
import {
  getRequirementMetadata,
  updateRequirementSkills,
} from "@/features/requirements/services/requirementProjectStore"
import { useRequirementWorkflow } from "@/features/requirements/services/requirementWorkflowStore"
import {
  workflowArtifactFromQuery,
  workflowLabel,
  workflowPhaseForArtifact,
  workflowSessionTitle,
  type WorkflowArtifact,
  type WorkflowPhase,
} from "@/features/requirements/services/workflowNavigation"
import { SKILL_SOURCE_LABELS, skillSource, type SkillInfo } from "@/features/skills/model"
import { Identifier } from "@/utils/id"
import type { RequirementItem, RequirementSendMode, RequirementSkillBindings } from "@/features/requirements/types"

type WorkbenchStatus = "draft" | "requirement_ready" | "design_ready" | "developing" | "test_ready" | "completed"
type WorkbenchPhase = WorkflowPhase
type WorkbenchFilter = "all" | WorkbenchPhase
type ArtifactKey = WorkflowArtifact
type SkillStage = keyof RequirementSkillBindings
type FlowSubstep = {
  label: string
  value: string
  complete?: boolean
  active?: boolean
}
type FlowStageStatus = {
  id: WorkbenchPhase
  artifact: ArtifactKey
  label: string
  value: string
  active?: boolean
  complete?: boolean
  steps: FlowSubstep[]
}
type WorkbenchAction = {
  label: string
  artifact?: ArtifactKey
  lock?: "requirement" | "design" | "development" | "test"
  generate?: RequirementSendMode
  waiting?: boolean
  session?: boolean
  done?: boolean
}

const WORKBENCH_FILTERS: Array<{ id: WorkbenchFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "requirement", label: "需求" },
  { id: "design", label: "设计" },
  { id: "development", label: "开发" },
  { id: "test", label: "测试" },
]

const ARTIFACTS: Array<{ id: ArtifactKey; label: string }> = [
  { id: "raw", label: "原始输入" },
  { id: "requirement", label: "需求产物" },
  { id: "design", label: "设计方案" },
  { id: "development", label: "开发摘要" },
  { id: "test", label: "测试报告" },
]

const EMPTY_SKILLS: RequirementSkillBindings = {
  requirement: [],
  design: [],
  development: [],
  test: [],
}
const SKILL_STAGES: Array<{ id: SkillStage; label: string }> = [
  { id: "requirement", label: "需求" },
  { id: "design", label: "设计" },
  { id: "development", label: "开发" },
  { id: "test", label: "测试" },
]
const REQUIREMENT_AGENT = "requirement-agent"
const DESIGN_AGENT = "design-agent"
const DEVELOPMENT_AGENT = "development-agent"
const TEST_AGENT = "testing-agent"

function phaseForStatus(status: WorkbenchStatus): WorkbenchPhase {
  if (status === "completed" || status === "test_ready") return "test"
  if (status === "developing" || status === "design_ready") return "development"
  if (status === "requirement_ready") return "design"
  return "requirement"
}

function phaseLabel(phase: WorkbenchPhase) {
  if (phase === "test") return "测试"
  if (phase === "development") return "开发"
  if (phase === "design") return "设计"
  return "需求"
}

function phaseClass(phase: WorkbenchPhase) {
  if (phase === "test") return "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]"
  if (phase === "development") return "bg-[var(--v2-blue-400)]/15 text-[var(--v2-blue-600)]"
  if (phase === "design") return "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]"
  return "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-muted)]"
}

function nextActionDescription(status: WorkbenchStatus) {
  if (status === "completed") return "流程已经完成，可以回看测试报告和交付证据。"
  if (status === "test_ready") return "开发摘要已经就绪，下一步建议生成测试报告并确认风险。"
  if (status === "developing") return "开发会话正在推进，继续进入会话完成实现或生成开发摘要。"
  if (status === "design_ready") return "设计方案已经确认，下一步进入开发会话并自动带上前置产物。"
  if (status === "requirement_ready") return "需求已经确认，下一步让设计智能体生成实现方案。"
  return "原始输入已经就绪，下一步生成结构化需求产物。"
}

function activeArtifactForStatus(status: WorkbenchStatus): ArtifactKey {
  if (status === "completed" || status === "test_ready") return "test"
  if (status === "developing") return "development"
  if (status === "design_ready") return "design"
  if (status === "requirement_ready") return "requirement"
  return "requirement"
}

function safeDate(iso: string | undefined) {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString()
}

function agentForStage(stage: RequirementSendMode) {
  if (stage === "test") return TEST_AGENT
  if (stage === "development") return DEVELOPMENT_AGENT
  if (stage === "design") return DESIGN_AGENT
  return REQUIREMENT_AGENT
}

function skillStageForMode(stage: RequirementSendMode): SkillStage {
  if (stage === "test") return "test"
  if (stage === "development") return "development"
  if (stage === "design") return "design"
  return "requirement"
}

function withBoundSkills(content: string, skills: string[]) {
  if (skills.length === 0) return content
  return [
    "本阶段已绑定以下 Skills，请在开始任务前使用 skill 工具逐一加载，并严格遵循这些 skill 的说明。",
    "如果某个 skill 无法加载，请在最终产物中说明原因，不要静默忽略。",
    "",
    "【绑定 Skills】",
    ...skills.map((skill) => `- ${skill}`),
    "",
    content,
  ].join("\n")
}

function sameArtifactPath(eventFile: string, artifactPath: string) {
  const eventPath = eventFile.replace(/\\/g, "/")
  const normalizedArtifact = artifactPath.replace(/\\/g, "/")
  return eventPath === normalizedArtifact || eventPath.endsWith(`/${normalizedArtifact}`)
}

function sameAnyArtifactPath(eventFile: string, artifactPaths: Array<string | undefined>) {
  return artifactPaths.some((path) => path && sameArtifactPath(eventFile, path))
}

function normalizeSkillDraft(skills?: RequirementSkillBindings): RequirementSkillBindings {
  return {
    requirement: [...new Set(skills?.requirement ?? [])],
    design: [...new Set(skills?.design ?? [])],
    development: [...new Set(skills?.development ?? [])],
    test: [...new Set(skills?.test ?? [])],
  }
}

function sameSkillList(left: string[], right: string[]) {
  return [...left].sort().join("\n") === [...right].sort().join("\n")
}

function sameSkillBindings(left: RequirementSkillBindings, right: RequirementSkillBindings) {
  return SKILL_STAGES.every((stage) => sameSkillList(left[stage.id], right[stage.id]))
}

function agentNames(input: unknown) {
  if (Array.isArray(input)) {
    return new Set(input.map((agent) => agentName(agent)).filter((name): name is string => !!name))
  }
  if (typeof input === "object" && input !== null) {
    return new Set(Object.values(input).map((agent) => agentName(agent)).filter((name): name is string => !!name))
  }
  return new Set<string>()
}

function agentName(input: unknown) {
  if (typeof input !== "object" || input === null) return undefined
  const name = (input as { name?: unknown }).name
  return typeof name === "string" ? name : undefined
}

const WorkbenchContent: Component = () => {
  const language = useLanguage()
  const server = useServer()
  const backend = useRequirements()
  const workflow = useRequirementWorkflow()
  const linkStore = useRequirementLinks()
  const dialog = useDialog()
  const [searchParams, setSearchParams] = useSearchParams<{ selectedId?: string; project?: string; artifact?: string }>()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal<WorkbenchFilter>("all")
  const [search, setSearch] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [deletingId, setDeletingId] = createSignal<string | null>(null)
  const [newTitle, setNewTitle] = createSignal("")
  const [newDescription, setNewDescription] = createSignal("")
  const [newPriority, setNewPriority] = createSignal<RequirementItem["priority"]>("medium")
  const [selectionProject, setSelectionProject] = createSignal<string | undefined>()
  const projectDir = createMemo(() =>
    resolveRequirementProject(
      searchParams.project,
      server.projects.list().map((project) => project.worktree),
      server.projects.last(),
    ),
  )
  const [items, { refetch }] = createResource(() => projectDir(), (project) => backend.listRequirements(project))
  const projectItems = createMemo(() => {
    const project = projectDir()
    if (!project) return []
    return (items() ?? []).filter((item) => item.projectId === project)
  })

  createEffect(() => {
    const project = projectDir()
    if (project === selectionProject()) return
    setSelectionProject(project)
    setSelectedId(null)
  })

  const itemStatus = (item: RequirementItem): WorkbenchStatus => {
    const project = projectDir() ?? ""
    const links = linkStore.getLinksByRequirement(project, item.id)
    const hasDevelopmentSession = links.some((link) => link.sourceMode === "development" && !!link.sessionId)
    const record = workflow.getRecord(project, item.id)
    if (workflow.isTestLocked(project, item.id)) return "completed"
    if (workflow.isDevelopmentLocked(project, item.id)) return "test_ready"
    if (workflow.isDesignLocked(project, item.id) && hasDevelopmentSession) return "developing"
    if (workflow.isDesignLocked(project, item.id)) return "design_ready"
    if (workflow.isLocked(project, item.id)) return "requirement_ready"
    if (record?.testGeneratedAt) return "test_ready"
    if (record?.developmentGeneratedAt) return "test_ready"
    if (record?.designGeneratedAt) return hasDevelopmentSession ? "developing" : "design_ready"
    return "draft"
  }

  const filteredItems = createMemo(() => {
    const query = search().trim().toLowerCase()
    return projectItems().filter((item) => {
      if (filter() !== "all" && phaseForStatus(itemStatus(item)) !== filter()) return false
      if (!query) return true
      return (
        item.id.toLowerCase().includes(query) ||
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
      )
    })
  })
  const statusCounts = createMemo(() =>
    projectItems().reduce<Record<WorkbenchFilter, number>>(
      (counts, item) => {
        const phase = phaseForStatus(itemStatus(item))
        return { ...counts, all: counts.all + 1, [phase]: counts[phase] + 1 }
      },
      {
        all: 0,
        requirement: 0,
        design: 0,
        development: 0,
        test: 0,
      },
    ),
  )

  createEffect(() => {
    const project = projectDir()
    if (!project) {
      setSelectedId(null)
      return
    }
    if (items.loading) return
    const currentItems = projectItems()
    if (searchParams.selectedId && currentItems.some((item) => item.id === searchParams.selectedId)) {
      setSelectedId(searchParams.selectedId)
      return
    }
    const first = filteredItems()[0]
    setSelectedId(first?.id ?? null)
  })

  function handleSelect(id: string) {
    const project = projectDir()
    if (!project) return
    setSelectedId(id)
    setSearchParams({ project, selectedId: id, artifact: undefined })
  }

  function resetCreateForm() {
    setNewTitle("")
    setNewDescription("")
    setNewPriority("medium")
  }

  async function handleCreate() {
    const project = projectDir()
    if (!project || creating() || !newTitle().trim() || !newDescription().trim()) return
    setCreating(true)
    try {
      const item = await backend.createRequirement(project, {
        title: newTitle().trim(),
        description: newDescription().trim(),
        priority: newPriority(),
      })
      resetCreateForm()
      dialog.close()
      await refetch()
      handleSelect(item.id)
      showToast({ title: "工作项已创建", variant: "success" })
    } catch {
      showToast({ title: "创建工作项失败", variant: "error" })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(item: RequirementItem) {
    const project = projectDir()
    if (!project || deletingId()) return
    setDeletingId(item.id)
    const wasSelected = selectedId() === item.id
    try {
      await backend.deleteRequirement(project, item.id)
      linkStore.removeRequirementLinks(project, item.id)
      workflow.removeRecord(project, item.id)
      await refetch()
      if (wasSelected) {
        const next = filteredItems().find((nextItem) => nextItem.id !== item.id)
        setSelectedId(next?.id ?? null)
        setSearchParams({ project, selectedId: next?.id, artifact: undefined })
      }
      showToast({ title: "工作项已删除", variant: "success" })
    } catch {
      showToast({ title: "删除工作项失败", variant: "error" })
    } finally {
      setDeletingId(null)
    }
  }

  function openCreateDialog() {
    resetCreateForm()
    dialog.show(() => (
      <Dialog size="x-large">
        <DialogHeader>
          <DialogTitleGroup
            title="新建工作项"
            description="先记录真实输入，不会自动生成需求产物。"
          />
        </DialogHeader>
        <DialogBody class="flex min-h-0 flex-1 flex-col px-5 pb-3">
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <label class="flex flex-col gap-1.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-muted)]">标题</span>
              <input
                value={newTitle()}
                onInput={(event) => setNewTitle(event.currentTarget.value)}
                class="h-8 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 text-[13px] text-[var(--v2-text-text-base)] outline-none focus:border-[var(--v2-blue-400)]"
                placeholder="输入工作项标题"
                autofocus
              />
            </label>
            <label class="flex min-h-0 flex-1 flex-col gap-1.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-muted)]">原始输入</span>
              <textarea
                value={newDescription()}
                onInput={(event) => setNewDescription(event.currentTarget.value)}
                class="min-h-[300px] flex-1 resize-none rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 py-2 text-[13px] leading-5 text-[var(--v2-text-text-base)] outline-none focus:border-[var(--v2-blue-400)]"
                placeholder="描述目标、背景、范围和验收标准"
              />
            </label>
            <label class="flex max-w-[180px] flex-col gap-1.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-muted)]">优先级</span>
              <select
                value={newPriority()}
                onChange={(event) => setNewPriority(event.currentTarget.value as RequirementItem["priority"])}
                class="h-8 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 text-[13px] text-[var(--v2-text-text-base)] outline-none focus:border-[var(--v2-blue-400)]"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 size="small" variant="ghost" onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2
            size="small"
            disabled={!newTitle().trim() || !newDescription().trim() || creating()}
            onClick={handleCreate}
          >
            {creating() ? "创建中..." : "创建"}
          </ButtonV2>
        </DialogFooter>
      </Dialog>
    ))
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <header class="shrink-0 border-b border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]/60 px-5 pb-3 pt-4">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">AI 工作台</h1>
            <Show when={projectDir()}>
              {(project) => (
                <p class="mt-1 flex min-w-0 items-center gap-1 truncate text-[12px] text-[var(--v2-text-text-muted)]" title={project()}>
                  <span>{language.t("requirements.detail.project")}：</span>
                  <span class="min-w-0 truncate font-[530] text-[var(--v2-text-text-base)]">{getFilename(project())}</span>
                </p>
              )}
            </Show>
          </div>
          <ButtonV2 size="small" icon="plus" disabled={!projectDir()} onClick={openCreateDialog}>
            新建工作项
          </ButtonV2>
        </div>
      </header>

      <div class="flex flex-1 min-h-0 flex-col lg:flex-row">
        <aside class="flex max-h-[44vh] w-full shrink-0 flex-col border-b border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] lg:h-full lg:max-h-none lg:w-[360px] lg:border-b-0 lg:border-r">
          <div class="shrink-0 px-4 pb-2 pt-3">
            <div class="relative">
              <Icon
                name="magnifying-glass"
                size="small"
                class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--v2-text-text-faint)]"
              />
              <input
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
                placeholder="搜索工作项"
                class="h-8 w-full rounded-[6px] border border-transparent bg-[var(--v2-background-bg-layer-01)] pl-8 pr-3 text-[13px] text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
              />
            </div>
            <div class="mt-2 grid grid-cols-5 gap-1 rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-1">
              <For each={WORKBENCH_FILTERS}>
                {(item) => (
                  <button
                    type="button"
                    onClick={() => setFilter(item.id)}
                    class="flex h-7 min-w-0 items-center justify-center rounded-[5px] px-1.5 text-[11px] font-[530] transition-colors"
                    classList={{
                      "bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-600)]": filter() === item.id,
                      "text-[var(--v2-text-text-muted)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--v2-text-text-base)]": filter() !== item.id,
                    }}
                  >
                    <span class="truncate">{item.label}</span>
                    <span class="ml-1 shrink-0 text-[10px] text-[var(--v2-text-text-faint)]">{statusCounts()[item.id]}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <Show when={items.loading && !items()}>
              <div class="flex flex-col gap-2 py-2">
                <For each={[1, 2, 3]}>
                  {() => <div class="h-20 rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />}
                </For>
              </div>
            </Show>
            <Show when={!items.loading && filteredItems().length === 0}>
              <div class="rounded-[8px] border border-dashed border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]/45 px-4 py-8 text-center">
                <p class="text-[13px] font-[530] text-[var(--v2-text-text-muted)]">
                  {projectItems().length ? "没有匹配的工作项" : "暂无工作项"}
                </p>
                <p class="mt-1 text-[12px] text-[var(--v2-text-text-faint)]">
                  {projectItems().length ? "换个关键词或状态再试试。" : "创建后会存储在当前项目的 docs/requirements 中。"}
                </p>
                <Show when={!projectItems().length}>
                  <ButtonV2 size="small" variant="neutral" icon="plus" class="mt-4" onClick={openCreateDialog}>
                    新建工作项
                  </ButtonV2>
                </Show>
              </div>
            </Show>
            <div class="flex flex-col gap-2">
              <For each={filteredItems()}>
                {(item) => {
                  const status = createMemo(() => itemStatus(item))
                  const phase = createMemo(() => phaseForStatus(status()))
                  return (
                    <button
                      type="button"
                      onClick={() => handleSelect(item.id)}
                      class="w-full rounded-[8px] border px-3 py-2.5 text-left transition-colors"
                      classList={{
                        "border-[var(--v2-blue-400)]/60 bg-[var(--v2-blue-400)]/5 shadow-[inset_2px_0_0_var(--v2-blue-400)]": selectedId() === item.id,
                        "border-transparent bg-transparent hover:border-[var(--v2-border-border-base)] hover:bg-[var(--v2-background-bg-layer-01)]": selectedId() !== item.id,
                      }}
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <p class="truncate text-[13px] font-[530] text-[var(--v2-text-text-base)]">
                            {item.id} {item.title}
                          </p>
                          <p class="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--v2-text-text-muted)]">
                            {item.description}
                          </p>
                        </div>
                        <span class={`shrink-0 rounded-[3px] px-1.5 py-0.5 text-[10px] font-[530] ${phaseClass(phase())}`}>
                          {phaseLabel(phase())}
                        </span>
                      </div>
                      <div class="mt-2 flex items-center justify-between gap-2">
                        <PriorityBadge priority={item.priority} />
                        <span class="text-[11px] text-[var(--v2-text-text-faint)]">{safeDate(item.updatedAt)}</span>
                      </div>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>
        </aside>

        <main class="min-w-0 flex-1">
          <Show
            when={projectDir()}
            fallback={
              <div class="flex h-full items-center justify-center px-6 text-center">
                <div>
                  <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">未选择项目</p>
                  <p class="mt-1 text-[12px] text-[var(--v2-text-text-faint)]">请先打开或选择一个项目，再管理 AI 工作项。</p>
                </div>
              </div>
            }
          >
            <Show
              when={selectedId()}
              fallback={
                <div class="flex h-full items-center justify-center px-6 text-center">
                  <div>
                    <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">选择或创建一个工作项</p>
                    <p class="mt-1 text-[12px] text-[var(--v2-text-text-faint)]">从工作项列表选择一项，再查看状态、产物和下一步动作。</p>
                    <ButtonV2
                      size="small"
                      variant="neutral"
                      icon="plus"
                      class="mt-4"
                      disabled={!projectDir()}
                      onClick={openCreateDialog}
                    >
                      新建工作项
                    </ButtonV2>
                  </div>
                </div>
              }
            >
              {(id) => (
                <WorkbenchDetail
                  id={id()}
                  project={projectDir()!}
                  deleting={deletingId() === id()}
                  onDelete={handleDelete}
                />
              )}
            </Show>
          </Show>
        </main>
      </div>
    </div>
  )
}

const WorkbenchDetail: Component<{
  id: string
  project: string
  deleting: boolean
  onDelete: (item: RequirementItem) => Promise<void>
}> = (props) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams<{ artifact?: string }>()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const backend = useRequirements()
  const workflow = useRequirementWorkflow()
  const linkStore = useRequirementLinks()
  const [activeArtifact, setActiveArtifact] = createSignal<ArtifactKey>("raw")
  const [runningAction, setRunningAction] = createSignal(false)
  const [savingSkills, setSavingSkills] = createSignal(false)
  const [editingArtifact, setEditingArtifact] = createSignal(false)
  const [savingArtifact, setSavingArtifact] = createSignal(false)
  const [showDelete, setShowDelete] = createSignal(false)
  const [artifactDraft, setArtifactDraft] = createSignal("")
  const [skillDraft, setSkillDraft] = createSignal<RequirementSkillBindings>(normalizeSkillDraft())
  const [expandedSkillStage, setExpandedSkillStage] = createSignal<SkillStage | null>(null)
  const [expandedFlowStage, setExpandedFlowStage] = createSignal<WorkbenchPhase | null>(null)
  const [data] = createResource(
    () => ({ id: props.id, project: props.project }),
    (source) => backend.getRequirementDetail(source.project, source.id),
  )
  const currentRequirement = createMemo(() => {
    const requirement = data()
    if (!requirement || requirement.id !== props.id || requirement.projectId !== props.project) return undefined
    return requirement
  })
  const [availableSkills] = createResource(
    () => ({ sdk: serverSDK().client, project: props.project }),
    async (source) => {
      const response = await source.sdk.app.skills({ directory: source.project })
      return response.data ?? []
    },
  )
  const [metadata, { refetch: refetchMetadata }] = createResource(
    () => ({ id: props.id, project: props.project }),
    (source) => getRequirementMetadata({ server: server.current, project: source.project, requirementId: source.id }),
  )
  const currentMetadata = createMemo(() => {
    const value = metadata()
    if (!value || value.id !== props.id || value.projectId !== props.project) return undefined
    return value
  })
  const [requirementDocument, { mutate: mutateRequirementDocument, refetch: refetchRequirementDocument }] = createResource(
    () => currentRequirement() ? { server: server.current, project: props.project, requirement: currentRequirement()! } : undefined,
    (source) => loadRequirementDocument(source),
  )
  const [designDocument, { mutate: mutateDesignDocument, refetch: refetchDesignDocument }] = createResource(
    () => currentRequirement() ? { server: server.current, project: props.project, requirement: currentRequirement()! } : undefined,
    (source) => loadDesignDocument(source),
  )
  const [developmentDocument, { mutate: mutateDevelopmentDocument, refetch: refetchDevelopmentDocument }] = createResource(
    () => currentRequirement() ? { server: server.current, project: props.project, requirement: currentRequirement()! } : undefined,
    (source) => loadDevelopmentDocument(source),
  )
  const [testDocument, { mutate: mutateTestDocument, refetch: refetchTestDocument }] = createResource(
    () => currentRequirement() ? { server: server.current, project: props.project, requirement: currentRequirement()! } : undefined,
    (source) => loadTestDocument(source),
  )
  const currentRequirementDocument = createMemo(() => {
    const document = requirementDocument()
    if (!document || !sameArtifactPath(document.path, requirementDocumentPath(props.id))) return undefined
    return document
  })
  const currentDesignDocument = createMemo(() => {
    const document = designDocument()
    if (!document || !sameArtifactPath(document.path, designDocumentPath(props.id))) return undefined
    return document
  })
  const currentDevelopmentDocument = createMemo(() => {
    const document = developmentDocument()
    if (!document || !sameArtifactPath(document.path, developmentDocumentPath(props.id))) return undefined
    return document
  })
  const currentTestDocument = createMemo(() => {
    const document = testDocument()
    if (!document || !sameArtifactPath(document.path, testDocumentPath(props.id))) return undefined
    return document
  })
  const locked = createMemo(() => workflow.isLocked(props.project, props.id))
  const designLocked = createMemo(() => workflow.isDesignLocked(props.project, props.id))
  const developmentLocked = createMemo(() => workflow.isDevelopmentLocked(props.project, props.id))
  const testLocked = createMemo(() => workflow.isTestLocked(props.project, props.id))
  const sessionStore = createMemo(() => serverSync().child(props.project, { bootstrap: true })[0])
  const sessionById = createMemo(() => new Map((sessionStore()?.session ?? []).map((session) => [session.id, session] as const)))
  const sessionReady = createMemo(() => !!sessionStore() && sessionStore()?.status !== "loading")
  const links = createMemo(() => linkStore.getLinksByRequirement(props.project, props.id).filter((link) => !!link.sessionId))
  const liveLinks = createMemo(() => {
    if (!sessionReady()) return links()
    return links().filter((link) => sessionById().has(link.sessionId))
  })
  const developmentLinks = createMemo(() => liveLinks().filter((link) => link.sourceMode === "development"))
  const workflowRecord = createMemo(() => workflow.getRecord(props.project, props.id) ?? currentMetadata()?.workflow)
  const requirementReady = createMemo(() =>
    locked() ||
    !!workflowRecord()?.designGeneratedAt ||
    !!workflowRecord()?.developmentGeneratedAt ||
    !!workflowRecord()?.testGeneratedAt ||
    !!currentDesignDocument()?.content.trim() ||
    !!currentDevelopmentDocument()?.content.trim() ||
    !!currentTestDocument()?.content.trim()
  )
  const designReady = createMemo(() =>
    designLocked() ||
    !!workflowRecord()?.developmentGeneratedAt ||
    !!workflowRecord()?.testGeneratedAt ||
    !!currentDevelopmentDocument()?.content.trim() ||
    !!currentTestDocument()?.content.trim()
  )
  const developmentReady = createMemo(() =>
    developmentLocked() ||
    !!workflowRecord()?.testGeneratedAt ||
    !!currentTestDocument()?.content.trim()
  )
  const status = createMemo<WorkbenchStatus>(() => {
    if (testLocked()) return "completed"
    if (developmentReady()) return "test_ready"
    if (designReady() && developmentLinks().length > 0) return "developing"
    if (designReady()) return "design_ready"
    if (requirementReady()) return "requirement_ready"
    return "draft"
  })
  const phase = createMemo(() => phaseForStatus(status()))
  const artifactState = createMemo<Record<ArtifactKey, { exists: boolean; path: string }>>(() => ({
    raw: {
      exists: !!currentRequirement()?.description.trim(),
      path: "",
    },
    requirement: {
      exists: !!currentRequirementDocument()?.content.trim(),
      path: requirementDocumentPath(props.id),
    },
    design: {
      exists: !!currentDesignDocument()?.content.trim(),
      path: designDocumentPath(props.id),
    },
    development: {
      exists: !!currentDevelopmentDocument()?.content.trim(),
      path: developmentDocumentPath(props.id),
    },
    test: {
      exists: !!currentTestDocument()?.content.trim(),
      path: testDocumentPath(props.id),
    },
  }))
  const stageStatusItems = createMemo<FlowStageStatus[]>(() => [
    {
      id: "requirement",
      artifact: "requirement",
      label: "需求阶段",
      value: requirementReady() ? "已完成" : currentRequirementDocument() ? "待确认" : existingStageLink("raw") ? "生成中" : "待生成",
      active: !requirementReady(),
      complete: requirementReady(),
      steps: [
        {
          label: "原始输入",
          value: currentRequirement()?.description.trim() ? "已就绪" : "待补充",
          complete: !!currentRequirement()?.description.trim(),
          active: !currentRequirement()?.description.trim(),
        },
        {
          label: "需求会话",
          value: currentRequirementDocument()?.content.trim() ? "已产出" : existingStageLink("raw") ? "已启动" : "待启动",
          complete: !!currentRequirementDocument()?.content.trim() || !!existingStageLink("raw"),
          active: false,
        },
        {
          label: "需求产物",
          value: currentRequirementDocument()?.content.trim() ? "已生成" : existingStageLink("raw") ? "生成中" : "待生成",
          complete: !!currentRequirementDocument()?.content.trim(),
          active: !!existingStageLink("raw") && !currentRequirementDocument()?.content.trim(),
        },
        {
          label: "确认产物",
          value: requirementReady() ? "已确认" : currentRequirementDocument()?.content.trim() ? "待确认" : "未开始",
          complete: requirementReady(),
          active: !!currentRequirementDocument()?.content.trim() && !requirementReady(),
        },
      ],
    },
    {
      id: "design",
      artifact: "design",
      label: "设计阶段",
      value: designReady() ? "已完成" : currentDesignDocument() ? "待确认" : requirementReady() ? "待生成" : "未开始",
      active: requirementReady() && !designReady(),
      complete: designReady(),
      steps: [
        {
          label: "前置需求",
          value: requirementReady() ? "已确认" : "待确认",
          complete: requirementReady(),
          active: false,
        },
        {
          label: "设计会话",
          value: currentDesignDocument()?.content.trim() ? "已产出" : existingStageLink("design") ? "已启动" : requirementReady() ? "待启动" : "未开始",
          complete: !!currentDesignDocument()?.content.trim() || !!existingStageLink("design") || designReady(),
          active: false,
        },
        {
          label: "设计方案",
          value: currentDesignDocument()?.content.trim() ? "已生成" : "待生成",
          complete: !!currentDesignDocument()?.content.trim() || designReady(),
          active: !!existingStageLink("design") && !currentDesignDocument()?.content.trim(),
        },
        {
          label: "确认设计",
          value: designReady() ? "已确认" : currentDesignDocument()?.content.trim() ? "待确认" : "未开始",
          complete: designReady(),
          active: !!currentDesignDocument()?.content.trim() && !designReady(),
        },
      ],
    },
    {
      id: "development",
      artifact: "development",
      label: "开发阶段",
      value: developmentReady() ? "已完成" : developmentLinks().length > 0 ? "开发中" : designReady() ? "待开发" : "未开始",
      active: designReady() && !developmentReady(),
      complete: developmentReady(),
      steps: [
        {
          label: "前置设计",
          value: designReady() ? "已确认" : "待确认",
          complete: designReady(),
          active: false,
        },
        {
          label: "开发会话",
          value: currentDevelopmentDocument()?.content.trim() ? "已产出" : developmentLinks().length > 0 ? "已启动" : designReady() ? "待启动" : "未开始",
          complete: !!currentDevelopmentDocument()?.content.trim() || developmentLinks().length > 0 || developmentReady(),
          active: false,
        },
        {
          label: "开发摘要",
          value: currentDevelopmentDocument()?.content.trim() ? "已生成" : "待生成",
          complete: !!currentDevelopmentDocument()?.content.trim() || developmentReady(),
          active: developmentLinks().length > 0 && !currentDevelopmentDocument()?.content.trim(),
        },
        {
          label: "确认开发",
          value: developmentReady() ? "已确认" : currentDevelopmentDocument()?.content.trim() ? "待确认" : "未开始",
          complete: developmentReady(),
          active: !!currentDevelopmentDocument()?.content.trim() && !developmentReady(),
        },
      ],
    },
    {
      id: "test",
      artifact: "test",
      label: "测试阶段",
      value: testLocked() ? "已完成" : currentTestDocument() ? "待确认" : developmentReady() ? "待生成" : "未开始",
      active: developmentReady() && !testLocked(),
      complete: testLocked(),
      steps: [
        {
          label: "前置开发",
          value: developmentReady() ? "已确认" : "待确认",
          complete: developmentReady(),
          active: false,
        },
        {
          label: "测试会话",
          value: currentTestDocument()?.content.trim() ? "已产出" : existingStageLink("test") ? "已启动" : developmentReady() ? "待启动" : "未开始",
          complete: !!currentTestDocument()?.content.trim() || !!existingStageLink("test") || testLocked(),
          active: false,
        },
        {
          label: "测试报告",
          value: currentTestDocument()?.content.trim() ? "已生成" : "待生成",
          complete: !!currentTestDocument()?.content.trim() || testLocked(),
          active: !!existingStageLink("test") && !currentTestDocument()?.content.trim(),
        },
        {
          label: "确认测试",
          value: testLocked() ? "已确认" : currentTestDocument()?.content.trim() ? "待确认" : "未开始",
          complete: testLocked(),
          active: !!currentTestDocument()?.content.trim() && !testLocked(),
        },
      ],
    },
  ])

  const mainAction = createMemo<WorkbenchAction>(() => {
    if (testLocked()) return { label: "流程已完成", done: true }
    if (currentTestDocument()?.content.trim()) return { label: "确认测试报告", lock: "test" as const }
    if (developmentLocked() && existingStageLink("test")) return { label: "等待测试报告生成", waiting: true }
    if (developmentLocked()) return { label: "生成测试报告", generate: "test" as RequirementSendMode }
    if (currentDevelopmentDocument()?.content.trim()) return { label: "确认开发摘要", lock: "development" as const }
    if (designLocked() && developmentLinks().length > 0) return { label: "进入开发会话", session: true }
    if (designLocked() && existingStageLink("development")) return { label: "等待开发摘要生成", waiting: true }
    if (designLocked()) return { label: "开始开发", generate: "development" as RequirementSendMode }
    if (currentDesignDocument()?.content.trim()) return { label: "确认设计方案", lock: "design" as const }
    if (locked() && existingStageLink("design")) return { label: "等待设计方案生成", waiting: true }
    if (locked()) return { label: "生成设计方案", generate: "design" as RequirementSendMode }
    if (currentRequirementDocument()?.content.trim()) return { label: "确认需求产物", lock: "requirement" as const }
    if (existingStageLink("raw")) return { label: "等待需求产物生成", waiting: true }
    return { label: "细化需求", generate: "raw" as RequirementSendMode }
  })

  const artifactContent = createMemo(() => {
    if (activeArtifact() === "raw") return currentRequirement()?.description ?? ""
    if (activeArtifact() === "test") return currentTestDocument()?.content
    if (activeArtifact() === "development") return currentDevelopmentDocument()?.content
    if (activeArtifact() === "design") return currentDesignDocument()?.content
    return currentRequirementDocument()?.content
  })
  const activeDocument = createMemo(() => {
    if (activeArtifact() === "test") return currentTestDocument()
    if (activeArtifact() === "development") return currentDevelopmentDocument()
    if (activeArtifact() === "design") return currentDesignDocument()
    if (activeArtifact() === "requirement") return currentRequirementDocument()
    return undefined
  })
  const canEditActiveArtifact = createMemo(() => {
    if (!activeDocument()?.content.trim()) return false
    if (activeArtifact() === "requirement") return !locked()
    if (activeArtifact() === "design") return locked() && !designLocked()
    if (activeArtifact() === "development") return designLocked() && !developmentLocked()
    if (activeArtifact() === "test") return developmentLocked() && !testLocked()
    return false
  })
  const artifactDirty = createMemo(() => artifactDraft() !== (activeDocument()?.content ?? ""))
  const waitingForArtifact = createMemo(() =>
    (!!existingStageLink("raw") && !currentRequirementDocument()) ||
    (!!existingStageLink("design") && !currentDesignDocument()) ||
    (!!existingStageLink("development") && !currentDevelopmentDocument()) ||
    (!!existingStageLink("test") && !currentTestDocument()),
  )
  const skillsDirty = createMemo(() => {
    const skills = normalizeSkillDraft(currentMetadata()?.skills)
    return !sameSkillBindings(skillDraft(), skills)
  })
  const canEditSkillStage = createMemo(() => (stage: SkillStage) => {
    if (stage === "requirement") return !currentRequirementDocument()?.content.trim() && !locked() && !existingStageLink("raw")
    if (stage === "design") return !currentDesignDocument()?.content.trim() && !designLocked() && !existingStageLink("design")
    if (stage === "development") return !currentDevelopmentDocument()?.content.trim() && !developmentLocked() && !existingStageLink("development")
    return !currentTestDocument()?.content.trim() && !testLocked() && !existingStageLink("test")
  })
  const skillOptions = createMemo(() => {
    const byName = new Map<string, SkillInfo>()
    ;(availableSkills() ?? []).forEach((skill) => byName.set(skill.name, skill))
    SKILL_STAGES.flatMap((stage) => skillDraft()[stage.id]).forEach((name) => {
      if (!byName.has(name)) byName.set(name, { name, location: "", content: "" })
    })
    return [...byName.values()].sort((left, right) => {
      const sourceOrder = { project: 0, global: 1, "built-in": 2 }
      return (
        sourceOrder[skillSource(left, props.project)] - sourceOrder[skillSource(right, props.project)] ||
        left.name.localeCompare(right.name)
      )
    })
  })

  createEffect(() => {
    props.id
    setSkillDraft(normalizeSkillDraft(currentMetadata()?.skills))
  })

  createEffect(() => {
    props.id
    const artifact = workflowArtifactFromQuery(searchParams.artifact) ?? activeArtifactForStatus(status())
    setActiveArtifact(artifact)
    setExpandedFlowStage(workflowPhaseForArtifact(artifact))
  })

  createEffect(() => {
    activeArtifact()
    props.id
    setEditingArtifact(false)
    setArtifactDraft(activeDocument()?.content ?? "")
  })

  createEffect(() => {
    if (!canEditActiveArtifact()) setEditingArtifact(false)
  })

  createEffect(() => {
    const content = activeDocument()?.content ?? ""
    if (!editingArtifact() || !artifactDirty()) setArtifactDraft(content)
  })

  createEffect(() => {
    if (!currentRequirementDocument()) return
    if (workflowArtifactFromQuery(searchParams.artifact)) return
    if (!locked()) setActiveArtifact("requirement")
  })

  createEffect(() => {
    if (!currentDesignDocument()) return
    workflow.markDesignGenerated(props.project, props.id)
    if (workflowArtifactFromQuery(searchParams.artifact)) return
    if (locked() && !designLocked()) setActiveArtifact("design")
  })

  createEffect(() => {
    if (!currentDevelopmentDocument()) return
    workflow.markDevelopmentGenerated(props.project, props.id)
    if (workflowArtifactFromQuery(searchParams.artifact)) return
    if (designLocked() && !developmentLocked()) setActiveArtifact("development")
  })

  createEffect(() => {
    if (!currentTestDocument()) return
    workflow.markTestGenerated(props.project, props.id)
    if (workflowArtifactFromQuery(searchParams.artifact)) return
    if (developmentLocked() && !testLocked()) setActiveArtifact("test")
  })

  createEffect(() => {
    const unsubscribe = serverSDK().event.on(props.project, (event) => {
      if (event.type !== "file.watcher.updated") return
      if (
        sameAnyArtifactPath(event.properties.file, [
          currentMetadata()?.documents.requirement,
          currentRequirementDocument()?.path,
          requirementDocumentPath(props.id),
        ])
      ) void refetchRequirementDocument()
      if (
        sameAnyArtifactPath(event.properties.file, [
          currentMetadata()?.documents.design,
          currentDesignDocument()?.path,
          designDocumentPath(props.id),
        ])
      ) void refetchDesignDocument()
      if (
        sameAnyArtifactPath(event.properties.file, [
          currentMetadata()?.documents.development,
          currentDevelopmentDocument()?.path,
          developmentDocumentPath(props.id),
        ])
      ) void refetchDevelopmentDocument()
      if (
        sameAnyArtifactPath(event.properties.file, [
          currentMetadata()?.documents.test,
          currentTestDocument()?.path,
          testDocumentPath(props.id),
        ])
      ) void refetchTestDocument()
    })
    onCleanup(unsubscribe)
  })

  createEffect(() => {
    if (!waitingForArtifact()) return
    void refreshArtifacts()
    const interval = window.setInterval(() => void refreshArtifacts(), 2000)
    onCleanup(() => window.clearInterval(interval))
  })

  createEffect(() => {
    const current = links()
    if (current.length === 0) return
    const directories = new Set(current.map((link) => link.sessionDirectory || link.projectPath || props.project).filter(Boolean))
    const unsubscribe = [...directories].map((directory) =>
      serverSDK().event.on(directory, (event) => {
        if (event.type !== "session.deleted" && event.type !== "session.updated") return
        const info = event.properties.info
        if (event.type === "session.updated" && !info.time?.archived) return
        current
          .filter((link) => link.sessionId === info.id)
          .forEach((link) => linkStore.unlinkRequirementFromSession(link.projectId, link.requirementId, link.sessionId))
      }),
    )
    onCleanup(() => unsubscribe.forEach((off) => off()))
  })

  createEffect(() => {
    if (!sessionReady()) return
    links()
      .filter((link) => !sessionById().has(link.sessionId))
      .forEach((link) => linkStore.unlinkRequirementFromSession(link.projectId, link.requirementId, link.sessionId))
  })

  function refreshArtifacts() {
    return Promise.all([
      refetchRequirementDocument(),
      refetchDesignDocument(),
      refetchDevelopmentDocument(),
      refetchTestDocument(),
    ])
  }

  function promptContent(stage: RequirementSendMode, item: RequirementItem) {
    const skills = normalizeSkillDraft(currentMetadata()?.skills)[skillStageForMode(stage)]
    if (stage === "test") return withBoundSkills(buildTestContent(item, currentDevelopmentDocument()?.content.trim() ?? ""), skills)
    if (stage === "development") return withBoundSkills(buildDevelopmentContent(item, currentDesignDocument()?.content.trim() ?? ""), skills)
    if (stage === "design") return withBoundSkills(buildDesignContent(item, currentRequirementDocument()?.content.trim() ?? ""), skills)
    return withBoundSkills(buildRawContent(item), skills)
  }

  function existingStageLink(stage: RequirementSendMode) {
    return liveLinks().find((link) => link.sourceMode === stage)
  }

  async function runStageSession(stage: RequirementSendMode) {
    const item = currentRequirement()
    if (!item || runningAction()) return
    const existing = existingStageLink(stage)
    if (existing?.sessionId) {
      showToast({ title: "已有相关会话，可在右侧关联会话中进入", variant: "default" })
      return
    }

    setRunningAction(true)
    try {
      if (stage === "test" && !currentDevelopmentDocument()?.content.trim()) {
        showToast({ title: "未找到开发产物，请先刷新或确认开发摘要", variant: "error" })
        return
      }
      const content = promptContent(stage, item)
      const sdk = serverSDK().ensureDirSdkContext(props.project)
      if (!(await agentExists(sdk.client, agentForStage(stage)))) {
        showToast({ title: `未找到 ${agentForStage(stage)}，请先在智能体页面创建或启用`, variant: "error" })
        return
      }
      const session = await sdk.client.session.create().then((response) => response.data)
      if (!session) throw new Error("Failed to create workflow session")
      const promptResult = await sdk.client.session.promptAsync({
        sessionID: session.id,
        agent: agentForStage(stage),
        messageID: Identifier.ascending("message"),
        parts: [{ type: "text", text: content }],
      })
      if (promptResult.error) throw promptResult.error
      linkStore.createLink({
        projectId: props.project,
        projectPath: props.project,
        requirementId: item.id,
        requirementTitle: item.title,
        sessionId: session.id,
        sessionTitle: `${item.id} ${item.title} - ${workflowSessionTitle(stage)}`,
        sessionDirectory: props.project,
        sourceMode: stage,
        status: "session_created",
        content,
      })
      showToast({ title: `${workflowLabel(stage)}智能体已开始处理`, variant: "success" })
      if (stage === "raw") setActiveArtifact("requirement")
      if (stage === "design") setActiveArtifact("design")
      if (stage === "development") setActiveArtifact("development")
      if (stage === "test") setActiveArtifact("test")
      void refreshArtifacts()
    } catch {
      showToast({ title: "启动智能体失败", variant: "error" })
    } finally {
      setRunningAction(false)
    }
  }

  function lockCurrentStage(stage: "requirement" | "design" | "development" | "test") {
    if (stage === "requirement") {
      workflow.lockRequirement(props.project, props.id)
      setActiveArtifact("requirement")
      showToast({ title: "需求已确认", variant: "success" })
      return
    }
    if (stage === "design") {
      workflow.lockDesign(props.project, props.id)
      setActiveArtifact("design")
      showToast({ title: "设计已确认", variant: "success" })
      return
    }
    if (stage === "development") {
      workflow.lockDevelopment(props.project, props.id)
      setActiveArtifact("development")
      showToast({ title: "开发摘要已确认", variant: "success" })
      return
    }
    workflow.lockTest(props.project, props.id)
    setActiveArtifact("test")
    showToast({ title: "测试报告已确认", variant: "success" })
  }

  function handleMainAction() {
    const action = mainAction()
    if (action.done) {
      setActiveArtifact("test")
      showToast({ title: "流程已完成，可在测试报告中查看交付结果", variant: "success" })
      return
    }
    if (action.artifact) {
      setActiveArtifact(action.artifact)
      return
    }
    if (action.lock) {
      lockCurrentStage(action.lock)
      return
    }
    if (action.generate) {
      void runStageSession(action.generate)
      return
    }
    if (action.waiting) {
      showToast({ title: "智能体正在处理，可从关联会话查看进度", variant: "default" })
      return
    }
    if (action.session) {
      const link = developmentLinks()[0]
      const directory = link?.sessionDirectory || link?.projectPath || props.project
      if (link?.sessionId) {
        navigate(`/${base64Encode(directory)}/session/${link.sessionId}`)
        return
      }
      showToast({ title: "暂无开发会话，请先开始开发", variant: "default" })
      return
    }
  }

  async function handleSaveSkills() {
    if (savingSkills()) return
    setSavingSkills(true)
    try {
      const current = normalizeSkillDraft(currentMetadata()?.skills)
      const next = {
        requirement: canEditSkillStage()("requirement") ? skillDraft().requirement : current.requirement,
        design: canEditSkillStage()("design") ? skillDraft().design : current.design,
        development: canEditSkillStage()("development") ? skillDraft().development : current.development,
        test: canEditSkillStage()("test") ? skillDraft().test : current.test,
      }
      await updateRequirementSkills({
        server: server.current,
        project: props.project,
        requirementId: props.id,
        skills: next,
      })
      await refetchMetadata()
      showToast({ title: "Skills 已绑定", variant: "success" })
    } catch {
      showToast({ title: "保存 Skills 失败", variant: "error" })
    } finally {
      setSavingSkills(false)
    }
  }

  async function handleSaveArtifact() {
    const document = activeDocument()
    if (!document || !canEditActiveArtifact() || savingArtifact()) return
    setSavingArtifact(true)
    try {
      await saveRequirementDocument({
        server: server.current,
        project: props.project,
        path: document.path,
        content: artifactDraft(),
      })
      const updated = { ...document, content: artifactDraft() }
      if (activeArtifact() === "requirement") mutateRequirementDocument(updated)
      if (activeArtifact() === "design") mutateDesignDocument(updated)
      if (activeArtifact() === "development") mutateDevelopmentDocument(updated)
      if (activeArtifact() === "test") mutateTestDocument(updated)
      setEditingArtifact(false)
      showToast({ title: "产物已保存", variant: "success" })
    } catch {
      showToast({ title: "保存产物失败", variant: "error" })
    } finally {
      setSavingArtifact(false)
    }
  }

  function handleOpenSession(sessionId: string, directory: string | undefined) {
    navigate(`/${base64Encode(directory || props.project)}/session/${sessionId}`)
  }

  function toggleSkill(stage: SkillStage, name: string) {
    if (!canEditSkillStage()(stage)) return
    setSkillDraft((current) => {
      const selected = current[stage].includes(name)
        ? current[stage].filter((item) => item !== name)
        : [...current[stage], name]
      return { ...current, [stage]: selected }
    })
  }

  async function agentExists(client: ReturnType<typeof serverSDK>["client"], agent: string) {
    const response = await client.app.agents()
    return agentNames(response.data).has(agent)
  }

  async function handleDeleteRequirement(item: RequirementItem) {
    if (props.deleting) return
    await props.onDelete(item)
    setShowDelete(false)
  }

  return (
    <div class="flex h-full min-h-0">
      <section class="min-w-0 flex-1 overflow-y-auto bg-[var(--v2-background-bg-base)] px-4 pb-6 pt-4 lg:px-5">
        <Show when={data.loading && !currentRequirement()}>
          <div class="flex flex-col gap-3">
            <div class="h-7 w-2/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
            <div class="h-40 rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
          </div>
        </Show>
        <Show when={!data.loading && !currentRequirement()}>
          <div class="flex h-full items-center justify-center text-[13px] text-[var(--v2-text-text-muted)]">
            未找到该工作项
          </div>
        </Show>
        <Show when={currentRequirement()}>
          {(item) => (
            <div class="flex w-full max-w-none flex-col gap-4">
              <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="mb-2 flex items-center gap-2">
                      <span class={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-[530] ${phaseClass(phase())}`}>
                        {phaseLabel(phase())}
                      </span>
                      <PriorityBadge priority={item().priority} />
                    </div>
                    <h2 class="truncate text-[18px] font-[530] text-[var(--v2-text-text-base)]">
                      {item().id} {item().title}
                    </h2>
                    <p class="mt-1 text-[12px] leading-5 text-[var(--v2-text-text-muted)]">
                      更新时间：{safeDate(item().updatedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="h-7 shrink-0 rounded-[6px] border border-transparent px-2.5 text-[12px] font-[530] text-[var(--v2-red-600)] transition-colors hover:border-[var(--v2-red-400)]/30 hover:bg-[var(--v2-red-400)]/8 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={props.deleting || runningAction() || savingArtifact() || savingSkills()}
                    onClick={() => setShowDelete(true)}
                  >
                    删除
                  </button>
                </div>
              </div>

              <div class="flex min-h-[calc(100vh-190px)] flex-col overflow-hidden rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] shadow-sm">
                <div class="border-b border-[var(--v2-border-border-base)] px-4 py-3">
                  <div class="grid grid-cols-5 gap-1 rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] p-1">
                    <For each={ARTIFACTS}>
                      {(artifact) => (
                        <button
                          type="button"
                          onClick={() => setActiveArtifact(artifact.id)}
                          class="flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[12px] font-[530] transition-colors"
                          classList={{
                            "bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-600)]": activeArtifact() === artifact.id,
                            "text-[var(--v2-text-text-muted)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--v2-text-text-base)]": activeArtifact() !== artifact.id,
                          }}
                        >
                          <span
                            class="size-1.5 shrink-0 rounded-full"
                            classList={{
                              "bg-[var(--v2-green-500)]": artifactState()[artifact.id].exists,
                              "bg-[var(--v2-text-text-faint)]": !artifactState()[artifact.id].exists,
                            }}
                          />
                          <span class="min-w-0 truncate">{artifact.label}</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="mt-2 flex min-h-7 min-w-0 items-center justify-between gap-3 px-1">
                    <div class="min-w-0">
                      <Show when={artifactState()[activeArtifact()].path}>
                        {(path) => (
                          <p class="min-w-0 truncate font-mono text-[11px] text-[var(--v2-text-text-faint)]" title={path()}>
                            {path()}
                          </p>
                        )}
                      </Show>
                    </div>
                    <Show when={canEditActiveArtifact()}>
                      <div class="flex shrink-0 items-center gap-3">
                        <Show
                          when={editingArtifact()}
                          fallback={
                            <button
                              type="button"
                              onClick={() => setEditingArtifact(true)}
                              class="inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-[530] text-[var(--v2-text-text-muted)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--v2-blue-600)]"
                            >
                              <Icon name="edit" size="small" class="size-3" />
                              编辑
                            </button>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setArtifactDraft(activeDocument()?.content ?? "")
                              setEditingArtifact(false)
                            }}
                            class="h-6 rounded-[5px] px-2 text-[11px] font-[530] text-[var(--v2-text-text-muted)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--v2-text-text-base)]"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={savingArtifact() || !artifactDirty()}
                            onClick={handleSaveArtifact}
                            class="h-6 rounded-[5px] bg-[var(--v2-blue-400)]/10 px-2.5 text-[11px] font-[530] text-[var(--v2-blue-600)] transition-colors hover:bg-[var(--v2-blue-400)]/15 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[var(--v2-text-text-faint)]"
                          >
                            {savingArtifact() ? "保存中" : "保存"}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
                <div class="flex min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <Show
                    when={editingArtifact()}
                    fallback={
                      <Show
                        when={artifactContent()}
                        fallback={
                          <div class="flex min-h-[calc(100vh-330px)] flex-1 items-center justify-center text-center">
                            <div>
                              <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">暂无产物</p>
                              <p class="mt-1 text-[12px] text-[var(--v2-text-text-faint)]">
                                {activeArtifact() === "raw" ? "这个工作项还没有原始输入。" : "执行下一步动作后，产物会落盘到项目目录。"}
                              </p>
                            </div>
                          </div>
                        }
                      >
                        {(content) => (
                          <div class="min-h-[calc(100vh-330px)] flex-1">
                            <Markdown
                              text={content()}
                              cacheKey={`workbench:${props.id}:${activeArtifact()}:${content()}`}
                              class="text-[13px] leading-relaxed text-[var(--v2-text-text-muted)]"
                            />
                          </div>
                        )}
                      </Show>
                    }
                  >
                    <div class="flex min-h-[calc(100vh-330px)] flex-1">
                      <textarea
                        value={artifactDraft()}
                        onInput={(event) => setArtifactDraft(event.currentTarget.value)}
                        class="min-h-[700px] w-full flex-1 resize-y rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-4 py-3 font-mono text-[13px] leading-6 text-[var(--v2-text-text-base)] outline-none focus:border-[var(--v2-blue-400)]"
                        spellcheck={false}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
      </section>

      <aside class="hidden w-[330px] shrink-0 overflow-y-auto border-l border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] px-4 pb-4 pt-4 xl:block">
        <div class="flex flex-col gap-3">
          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <h3 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)]">下一步</h3>
            </div>
            <Show
              when={mainAction().done}
              fallback={
                <ButtonV2 size="normal" class="w-full" disabled={runningAction()} onClick={handleMainAction}>
                  {runningAction() ? "启动中..." : mainAction().label}
                </ButtonV2>
              }
            >
              <div class="flex h-9 items-center justify-center rounded-[6px] border border-[var(--v2-green-500)]/20 bg-[var(--v2-green-500)]/10 text-[13px] font-[530] text-[var(--v2-green-600)]">
                流程已完成
              </div>
            </Show>
            <p class="mt-2 text-[11px] leading-5 text-[var(--v2-text-text-faint)]">
              {nextActionDescription(status())}
            </p>
          </div>

          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
            <h3 class="mb-3 text-[11px] font-[530] text-[var(--v2-text-text-faint)]">流程状态</h3>
            <div class="flex flex-col gap-2">
              <For each={stageStatusItems()}>
                {(stage) => (
                  <div
                    class="rounded-[7px] border transition-colors"
                    classList={{
                      "border-[var(--v2-blue-400)]/30 bg-[var(--v2-blue-400)]/[0.03]": expandedFlowStage() === stage.id,
                      "border-transparent": expandedFlowStage() !== stage.id,
                    }}
                  >
                    <button
                      type="button"
                      class="flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                      onClick={() => {
                        setActiveArtifact(stage.artifact)
                        setExpandedFlowStage(expandedFlowStage() === stage.id ? null : stage.id)
                      }}
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        <Icon
                          name={expandedFlowStage() === stage.id ? "chevron-down" : "chevron-right"}
                          size="small"
                          class="shrink-0 text-[var(--v2-text-text-faint)]"
                        />
                        <span
                          class="size-1.5 shrink-0 rounded-full"
                          classList={{
                            "bg-[var(--v2-green-500)]": stage.complete,
                            "bg-[var(--v2-blue-500)]": stage.active && !stage.complete,
                            "bg-[var(--v2-text-text-faint)]": !stage.active && !stage.complete,
                          }}
                        />
                        <span class="truncate text-[12px] text-[var(--v2-text-text-base)]">{stage.label}</span>
                      </span>
                      <span
                        class="shrink-0 rounded-[3px] px-1.5 py-0.5 text-[10px] font-[530]"
                        classList={{
                          "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]": stage.complete,
                          "bg-[var(--v2-blue-400)]/15 text-[var(--v2-blue-600)]": stage.active && !stage.complete,
                          "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]": !stage.active && !stage.complete,
                        }}
                      >
                        {stage.value}
                      </span>
                    </button>
                    <Show when={expandedFlowStage() === stage.id}>
                      <div class="ml-7 mr-2 mb-2 mt-0.5 flex flex-col gap-1 border-l border-[var(--v2-border-border-base)] pl-3">
                        <For each={stage.steps}>
                          {(step) => (
                            <div class="flex min-h-6 items-center justify-between gap-2">
                              <span class="flex min-w-0 items-center gap-2">
                                <span
                                  class="size-1.5 shrink-0 rounded-full"
                                  classList={{
                                    "bg-[var(--v2-green-500)]": step.complete,
                                    "bg-[var(--v2-blue-500)]": step.active && !step.complete,
                                    "bg-[var(--v2-text-text-faint)]/60": !step.active && !step.complete,
                                  }}
                                />
                                <span class="truncate text-[11px] text-[var(--v2-text-text-muted)]">{step.label}</span>
                              </span>
                              <span
                                class="shrink-0 text-[10px] font-[530]"
                                classList={{
                                  "text-[var(--v2-green-600)]": step.complete,
                                  "text-[var(--v2-blue-600)]": step.active && !step.complete,
                                  "text-[var(--v2-text-text-faint)]": !step.active && !step.complete,
                                }}
                              >
                                {step.value}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <h3 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)]">绑定 Skills</h3>
              <Show when={skillsDirty()}>
                <span class="text-[10px] font-[530] text-[var(--v2-blue-600)]">未保存</span>
              </Show>
            </div>
            <div class="flex flex-col gap-2">
              <For each={SKILL_STAGES}>
                {(stage) => (
                  <SkillBindingSelector
                    label={stage.label}
                    options={skillOptions()}
                    project={props.project}
                    selected={skillDraft()[stage.id]}
                    expanded={expandedSkillStage() === stage.id}
                    loading={availableSkills.loading}
                    disabled={!canEditSkillStage()(stage.id)}
                    onToggleExpanded={() =>
                      setExpandedSkillStage(expandedSkillStage() === stage.id ? null : stage.id)
                    }
                    onToggleSkill={(name) => toggleSkill(stage.id, name)}
                  />
                )}
              </For>
              <ButtonV2 size="small" variant="ghost" disabled={savingSkills() || !skillsDirty()} onClick={handleSaveSkills}>
                {savingSkills() ? "保存中..." : "保存绑定"}
              </ButtonV2>
            </div>
          </div>

          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
            <h3 class="mb-3 text-[11px] font-[530] text-[var(--v2-text-text-faint)]">关联会话</h3>
            <Show
              when={liveLinks().length > 0}
              fallback={
                <div class="rounded-[6px] border border-dashed border-[var(--v2-border-border-base)] px-3 py-2.5 text-[12px] text-[var(--v2-text-text-faint)]">
                  暂无关联会话
                </div>
              }
            >
              <div class="flex flex-col gap-1.5">
                <For each={liveLinks()}>
                  {(link) => (
                    <button
                      type="button"
                      onClick={() => handleOpenSession(link.sessionId, link.sessionDirectory || link.projectPath)}
                      class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3 py-2 text-left transition-colors hover:border-[var(--v2-blue-400)]/50"
                    >
                      <p class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]">
                        {sessionById().get(link.sessionId)?.title || link.sessionTitle || link.sessionId}
                      </p>
                      <p class="mt-1 text-[11px] text-[var(--v2-text-text-faint)]">{workflowLabel(link.sourceMode)}会话</p>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </aside>
      <Show when={showDelete() && currentRequirement()}>
        {(item) => (
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
            <div class="w-full max-w-[420px] rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] p-4 shadow-xl">
              <div class="flex items-start gap-3">
                <div class="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--v2-red-500)]/10 text-[var(--v2-red-600)]">
                  <Icon name="trash" size="small" />
                </div>
                <div class="min-w-0">
                  <h3 class="text-[14px] font-[530] text-[var(--v2-text-text-base)]">删除工作项</h3>
                  <p class="mt-1 text-[12px] leading-5 text-[var(--v2-text-text-muted)]">
                    确定要删除「{item().id} {item().title}」吗？工作项会从 AI 工作台移除，已生成的产物文档和会话不会被删除。
                  </p>
                </div>
              </div>
              <div class="mt-4 flex justify-end gap-2">
                <ButtonV2 size="small" variant="ghost" disabled={props.deleting} onClick={() => setShowDelete(false)}>
                  取消
                </ButtonV2>
                <ButtonV2 size="small" variant="danger" disabled={props.deleting} onClick={() => void handleDeleteRequirement(item())}>
                  {props.deleting ? "删除中..." : "删除"}
                </ButtonV2>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

const SkillBindingSelector: Component<{
  label: string
  options: SkillInfo[]
  project: string
  selected: string[]
  expanded: boolean
  loading: boolean
  disabled: boolean
  onToggleExpanded: () => void
  onToggleSkill: (name: string) => void
}> = (props) => {
  return (
    <div
      class="rounded-[7px] border bg-[var(--v2-background-bg-deep)] transition-colors"
      classList={{
        "border-[var(--v2-blue-400)]/35": props.expanded,
        "border-[var(--v2-border-border-base)]": !props.expanded,
      }}
    >
      <button
        type="button"
        class="flex min-h-10 w-full items-center justify-between gap-2 rounded-[7px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
        classList={{
          "bg-[var(--v2-blue-400)]/5": props.expanded,
          "opacity-70": props.disabled,
        }}
        onClick={props.onToggleExpanded}
      >
        <span class="flex min-w-0 items-center gap-2">
          <span
            class="w-8 shrink-0 text-[11px] font-[600]"
            classList={{
              "text-[var(--v2-blue-600)]": props.expanded,
              "text-[var(--v2-text-text-base)]": !props.expanded,
            }}
          >
            {props.label}
          </span>
          <span class="flex min-w-0 flex-wrap gap-1">
            <Show
              when={props.selected.length > 0}
              fallback={<span class="text-[11px] text-[var(--v2-text-text-muted)]">未绑定</span>}
            >
              <For each={props.selected.slice(0, 2)}>
                {(name) => (
                  <span class="max-w-[86px] truncate rounded-[4px] border border-[var(--v2-blue-400)]/25 bg-[var(--v2-blue-400)]/10 px-1.5 py-0.5 text-[10px] font-[600] text-[var(--v2-blue-600)]" title={name}>
                    {name}
                  </span>
                )}
              </For>
              <Show when={props.selected.length > 2}>
                <span class="rounded-[4px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-02)] px-1.5 py-0.5 text-[10px] font-[600] text-[var(--v2-text-text-muted)]">
                  +{props.selected.length - 2}
                </span>
              </Show>
            </Show>
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <Show when={props.disabled}>
            <span class="text-[10px] text-[var(--v2-text-text-faint)]">已固定</span>
          </Show>
          <Icon
            name="chevron-right"
            size="small"
            class="text-[var(--v2-text-text-faint)] transition-transform"
            classList={{ "rotate-90": props.expanded }}
          />
        </span>
      </button>
      <Show when={props.expanded}>
        <div class="mx-2 mb-2 max-h-[260px] overflow-y-auto rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] p-1.5 shadow-sm">
          <Show
            when={props.options.length > 0}
            fallback={
              <div class="px-2 py-2 text-[12px] text-[var(--v2-text-text-faint)]">
                {props.loading ? "正在读取 Skills..." : "暂无可选 Skills"}
              </div>
            }
          >
            <div class="flex flex-col gap-1">
              <For each={props.options}>
                {(skill) => {
                  const source = createMemo(() => skill.location ? skillSource(skill, props.project) : undefined)
                  const selected = createMemo(() => props.selected.includes(skill.name))
                  return (
                    <label
                      class="flex cursor-pointer items-start gap-2 rounded-[5px] border px-2 py-1.5 transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                      classList={{
                        "border-[var(--v2-blue-400)]/25 bg-[var(--v2-blue-400)]/7": selected(),
                        "border-transparent": !selected(),
                        "cursor-not-allowed opacity-70": props.disabled,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected()}
                        disabled={props.disabled}
                        onChange={() => props.onToggleSkill(skill.name)}
                        class="mt-0.5 size-3.5 accent-[var(--v2-blue-500)]"
                      />
                      <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-center gap-1.5">
                          <span class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]">
                            {skill.name}
                          </span>
                          <Show when={source()}>
                            {(value) => (
                              <span class="shrink-0 rounded-[3px] bg-[var(--v2-background-bg-layer-02)] px-1.5 py-0.5 text-[10px] text-[var(--v2-text-text-faint)]">
                                {SKILL_SOURCE_LABELS[value()]}
                              </span>
                            )}
                          </Show>
                        </span>
                        <Show when={skill.description}>
                          <span class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--v2-text-text-faint)]">
                            {skill.description}
                          </span>
                        </Show>
                      </span>
                    </label>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const WorkbenchPage: Component = () => (
  <RequirementsProvider>
    <WorkbenchContent />
  </RequirementsProvider>
)

export default WorkbenchPage
