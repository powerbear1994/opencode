import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useRequirements } from "./provider"
import { StatusBadge, PriorityBadge } from "./badge"
import { useRequirementWorkflow } from "./services/requirementWorkflowStore"
import {
  developmentDocumentPath,
  loadDesignDocument,
  loadDevelopmentDocument,
  loadRequirementDocument,
  loadTestDocument,
  requirementDocumentPath,
  designDocumentPath,
  testDocumentPath,
} from "./services/requirementDocument"
import type { RequirementItem } from "./types"

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return iso
  }
}

function designStageLabel(workflow: ReturnType<typeof useRequirementWorkflow>, project: string, id: string, generated: boolean) {
  if (workflow.isDesignLocked(project, id)) return "已完成"
  if (generated) return "待确认"
  return "待生成"
}

function developmentStageLabel(workflow: ReturnType<typeof useRequirementWorkflow>, project: string, id: string, generated: boolean) {
  if (workflow.isDevelopmentLocked(project, id)) return "已完成"
  if (generated) return "待确认"
  return "待生成"
}

function testStageLabel(workflow: ReturnType<typeof useRequirementWorkflow>, project: string, id: string, generated: boolean) {
  if (workflow.isTestLocked(project, id)) return "已完成"
  if (generated) return "待确认"
  return "待生成"
}

type RequirementFilter = "all" | "pending" | "confirming" | "done"
type RequirementStage = "requirement" | "design" | "development" | "test"

function stageDocumentPath(stage: RequirementStage, requirementId: string) {
  if (stage === "test") return testDocumentPath(requirementId)
  if (stage === "development") return developmentDocumentPath(requirementId)
  if (stage === "design") return designDocumentPath(requirementId)
  return requirementDocumentPath(requirementId)
}

function loadStageDocument(input: {
  server: Parameters<typeof loadRequirementDocument>[0]["server"]
  project: string
  requirement: RequirementItem
  stage: RequirementStage
}) {
  if (input.stage === "test") return loadTestDocument(input)
  if (input.stage === "development") return loadDevelopmentDocument(input)
  if (input.stage === "design") return loadDesignDocument(input)
  return loadRequirementDocument(input)
}

function stagePrerequisiteLocked(
  stage: RequirementStage,
  workflow: ReturnType<typeof useRequirementWorkflow>,
  project: string,
  requirementId: string,
) {
  if (stage === "test") return workflow.isDevelopmentLocked(project, requirementId)
  if (stage === "development") return workflow.isDesignLocked(project, requirementId)
  if (stage === "design") return workflow.isLocked(project, requirementId)
  return workflow.isLocked(project, requirementId)
}

const REQUIREMENT_FILTERS: Array<{ id: RequirementFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "pending", label: "待生成" },
  { id: "confirming", label: "待确认" },
  { id: "done", label: "已完成" },
]

const DESIGN_FILTERS: Array<{ id: RequirementFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "pending", label: "待生成" },
  { id: "confirming", label: "待确认" },
  { id: "done", label: "已完成" },
]

function emptyText(input: { stage: RequirementStage; filter: RequirementFilter; hasSearch: boolean; emptyMessage?: string }) {
  if (input.hasSearch) {
    if (input.stage === "test") return "没有匹配的测试项"
    if (input.stage === "development") return "没有匹配的开发项"
    if (input.stage === "design") return "没有匹配的设计项"
    return "没有匹配的需求"
  }
  if (input.emptyMessage && input.filter === "all") return input.emptyMessage
  if (input.stage === "test") {
    if (input.filter === "pending") return "暂无待生成测试"
    if (input.filter === "confirming") return "暂无待确认测试"
    if (input.filter === "done") return "暂无已完成测试"
    return "暂无可测试的开发"
  }
  if (input.stage === "development") {
    if (input.filter === "pending") return "暂无待生成开发"
    if (input.filter === "confirming") return "暂无待确认开发"
    if (input.filter === "done") return "暂无已完成开发"
    return "暂无可开发的设计"
  }
  if (input.stage === "design") {
    if (input.filter === "pending") return "暂无待生成设计"
    if (input.filter === "confirming") return "暂无待确认设计"
    if (input.filter === "done") return "暂无已完成设计"
    return "暂无可设计的需求"
  }
  if (input.filter === "pending") return "暂无待生成需求"
  if (input.filter === "confirming") return "暂无待确认需求"
  if (input.filter === "done") return "暂无已完成需求"
  return "暂无需求"
}

// ── Component ───────────────────────────────────────────────────────────────

export const RequirementList: Component<{
  project?: string
  stage?: RequirementStage
  lockedOnly?: boolean
  emptyMessage?: string
  onSelect: (id: string) => void
  onDefaultSelect?: (id: string) => void
  selectedId?: string | null
}> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const workflow = useRequirementWorkflow()
  const [search, setSearch] = createSignal("")
  const [filter, setFilter] = createSignal<RequirementFilter>("all")
  const stage = createMemo(() => props.stage ?? "requirement")
  const filters = createMemo(() => (stage() === "design" ? DESIGN_FILTERS : REQUIREMENT_FILTERS))
  const hasSearch = createMemo(() => search().trim().length > 0)
  const currentEmptyText = createMemo(() =>
    emptyText({ stage: stage(), filter: filter(), hasSearch: hasSearch(), emptyMessage: props.emptyMessage }),
  )

  const [data, { refetch }] = createResource(() => props.project, (project) => backend.listRequirements(project))
  const [generatedDocuments, { refetch: refetchGeneratedDocuments }] = createResource(
    () => {
      const project = props.project
      const requirements = data()
      if (!project || !requirements) return
      return { project, requirements }
    },
    async (source) =>
      new Set(
        (
          await Promise.all(
            source.requirements.map(async (requirement) =>
              (await loadStageDocument({
                server: server.current,
                project: source.project,
                requirement,
                stage: stage(),
              }))
                ? requirement.id
                : undefined,
            ),
          )
        ).filter((id): id is string => !!id),
      ),
  )

  const generatedPaths = createMemo(
    () => new Set((data() ?? []).map((requirement) => stageDocumentPath(stage(), requirement.id))),
  )

  createEffect(() => {
    const project = props.project
    if (!project) return
    const unsubscribe = serverSDK.event.on(project, (event) => {
      if (event.type !== "file.watcher.updated") return
      if (!generatedPaths().has(event.properties.file)) return
      void refetchGeneratedDocuments()
    })
    onCleanup(unsubscribe)
  })

  const requirementStatus = (requirement: RequirementItem): RequirementItem["status"] => {
    if (workflow.isTestLocked(props.project ?? "", requirement.id)) return "done"
    if (requirement.status === "done") return "done"
    return generatedDocuments()?.has(requirement.id) ? "confirming" : "pending"
  }

  const filtered = createMemo(() => {
    const all = data() ?? []
    const q = search().toLowerCase().trim()
    const lockedOnly = all.filter((r) => !props.lockedOnly || stagePrerequisiteLocked(stage(), workflow, props.project ?? "", r.id))
    const scoped = lockedOnly.filter((r) => {
      const locked = workflow.isLocked(props.project ?? "", r.id)
      const generated = generatedDocuments()?.has(r.id) ?? false
      const designLocked = workflow.isDesignLocked(props.project ?? "", r.id)
      const developmentLocked = workflow.isDevelopmentLocked(props.project ?? "", r.id)
      const testLocked = workflow.isTestLocked(props.project ?? "", r.id)
      const status = requirementStatus(r)
      if (filter() === "all") return true
      if (stage() === "test") {
        if (filter() === "done") return testLocked
        if (filter() === "pending") return developmentLocked && !generated && !testLocked
        if (filter() === "confirming") return generated && !testLocked
        return true
      }
      if (stage() === "development") {
        if (filter() === "done") return developmentLocked
        if (filter() === "pending") return designLocked && !generated && !developmentLocked
        if (filter() === "confirming") return generated && !developmentLocked
        return true
      }
      if (stage() === "design") {
        if (filter() === "done") return designLocked
        if (filter() === "pending") return locked && !generated && !designLocked
        if (filter() === "confirming") return generated && !designLocked
        return true
      }
      if (filter() === "done") return status === "done" || locked
      if (filter() === "pending") return status === "pending" && !locked
      if (filter() === "confirming") return status === "confirming" && !locked
      return true
    })
    if (!q) return scoped
    return scoped.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    )
  })

  createEffect(() => {
    if (!props.project || props.selectedId || data.loading || data.error) return
    const first = filtered()[0]
    if (!first) return
    props.onDefaultSelect?.(first.id)
  })

  function renderStageBadge(req: RequirementItem) {
    const generated = generatedDocuments()?.has(req.id) ?? false
    if (stage() === "test") {
      return (
        <span
          class="inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440]"
          classList={{
            "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]": workflow.isTestLocked(props.project ?? "", req.id),
            "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]":
              !workflow.isTestLocked(props.project ?? "", req.id) && generated,
            "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]":
              !workflow.isTestLocked(props.project ?? "", req.id) && !generated,
          }}
        >
          {testStageLabel(workflow, props.project ?? "", req.id, generated)}
        </span>
      )
    }
    if (stage() === "development") {
      return (
        <span
          class="inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440]"
          classList={{
            "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]": workflow.isDevelopmentLocked(props.project ?? "", req.id),
            "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]":
              !workflow.isDevelopmentLocked(props.project ?? "", req.id) && generated,
            "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]":
              !workflow.isDevelopmentLocked(props.project ?? "", req.id) && !generated,
          }}
        >
          {developmentStageLabel(workflow, props.project ?? "", req.id, generated)}
        </span>
      )
    }
    if (stage() === "design") {
      return (
        <span
          class="inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440]"
          classList={{
            "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]": workflow.isDesignLocked(props.project ?? "", req.id),
            "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]":
              !workflow.isDesignLocked(props.project ?? "", req.id) && generated,
            "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]":
              !workflow.isDesignLocked(props.project ?? "", req.id) && !generated,
          }}
        >
          {designStageLabel(workflow, props.project ?? "", req.id, generated)}
        </span>
      )
    }
    return (
      <Show
        when={workflow.isLocked(props.project ?? "", req.id) && requirementStatus(req) !== "done"}
        fallback={<StatusBadge status={requirementStatus(req)} />}
      >
        <span class="inline-block rounded-[3px] bg-[var(--v2-green-400)]/15 px-1.5 py-0.5 text-[10px] font-[440] text-[var(--v2-green-600)]">
          已完成
        </span>
      </Show>
    )
  }

  return (
    <div class="flex flex-col h-full min-h-0">
      <Show when={props.project}>
        {/* Search */}
        <div class="shrink-0 px-4 pt-3 pb-2">
          <div class="relative">
            <Icon
              name="magnifying-glass"
              size="small"
              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--v2-text-text-faint)]"
            />
            <input
              type="text"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder={language.t("requirements.list.searchPlaceholder")}
              class="w-full h-8 pl-8 pr-3 rounded-[6px] bg-[var(--v2-background-bg-layer-01)] text-[13px] text-[var(--v2-text-text-base)] placeholder:text-[var(--v2-text-text-faint)] outline-none border border-transparent focus:border-[var(--v2-blue-400)] transition-colors"
            />
          </div>
          <div class="mt-2 flex gap-1 overflow-x-auto">
            <For each={filters()}>
              {(item) => (
                <button
                  type="button"
                  onClick={() => setFilter(item.id)}
                  class="h-7 shrink-0 rounded-[5px] px-2.5 text-[11px] font-[530] transition-colors"
                  classList={{
                    "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)]": filter() === item.id,
                    "text-[var(--v2-text-text-muted)] hover:bg-[var(--v2-overlay-simple-overlay-hover)] hover:text-[var(--v2-text-text-base)]": filter() !== item.id,
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Content */}
      <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {/* Loading */}
        <Show when={data.loading && !data()}>
          <div class="flex flex-col gap-2 py-2">
            <For each={[1, 2, 3, 4]}>
              {() => <div class="h-20 rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />}
            </For>
          </div>
        </Show>

        {/* Error */}
        <Show when={data.error}>
          <div class="flex flex-col items-center gap-3 py-8">
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">{language.t("requirements.list.error")}</p>
            <button
              type="button"
              onClick={() => refetch()}
              class="px-3 py-1.5 rounded-[6px] text-[13px] bg-[var(--v2-background-bg-layer-01)] text-[var(--v2-text-text-base)] hover:bg-[var(--v2-background-bg-layer-02)] transition-colors"
            >
              {language.t("requirements.list.retry")}
            </button>
          </div>
        </Show>

        {/* Empty */}
        <Show when={props.project && !data.loading && !data.error && filtered().length === 0}>
          <div class="flex flex-col items-center gap-2 py-12">
            <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">{currentEmptyText()}</p>
          </div>
        </Show>

        {/* List */}
        <Show when={!data.error && filtered().length > 0}>
          <div class="flex flex-col gap-2">
            <For each={filtered()}>
              {(req) => (
                <button
                  type="button"
                  onClick={() => props.onSelect(req.id)}
                  class="w-full text-left p-3 transition-colors cursor-pointer border rounded-[8px] relative"
                  classList={{
                    "bg-[var(--v2-background-bg-deep)] hover:bg-[var(--v2-background-bg-layer-01)] border-transparent hover:border-[var(--v2-border-border-base)]": req.id !== props.selectedId,
                    "bg-[var(--v2-background-bg-layer-01)] border-[var(--v2-border-border-base)] hover:bg-[var(--v2-background-bg-layer-02)]": req.id === props.selectedId,
                  }}
                >
                  {/* Selected indicator */}
                  <Show when={req.id === props.selectedId}>
                    <div class="absolute left-0 top-[5px] bottom-[5px] w-[2.5px] bg-[var(--v2-blue-400)] rounded-r-[2px]" />
                  </Show>

                  {/* Title row */}
                  <div class="mb-1 flex items-start justify-between gap-2">
                    <span class="min-w-0 text-[13px] font-[530] text-[var(--v2-text-text-base)] truncate">
                      <span class="text-[var(--v2-text-text-faint)]">{req.id}</span>{" "}
                      {req.title}
                    </span>
                    <span class="shrink-0 text-[10px] font-[440] text-[var(--v2-text-text-faint)]">
                      {formatDate(req.updatedAt)}
                    </span>
                  </div>

                  {/* Primary badges row */}
                  <div class="flex items-center gap-1.5 flex-wrap">
                    {renderStageBadge(req)}
                    <PriorityBadge priority={req.priority} />
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
