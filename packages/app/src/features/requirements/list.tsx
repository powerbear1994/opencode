import { For, Show, createMemo, createResource, createSignal, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useRequirements } from "./provider"
import { StatusBadge, PriorityBadge } from "./badge"
import { useRequirementWorkflow } from "./services/requirementWorkflowStore"

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return iso
  }
}

type RequirementFilter = "all" | "todo" | "locked" | "doing" | "done"

const FILTERS: Array<{ id: RequirementFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "todo", label: "待处理" },
  { id: "locked", label: "已锁定" },
  { id: "doing", label: "进行中" },
  { id: "done", label: "已完成" },
]

// ── Component ───────────────────────────────────────────────────────────────

export const RequirementList: Component<{
  project?: string
  onSelect: (id: string) => void
  selectedId?: string | null
}> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const workflow = useRequirementWorkflow()
  const [search, setSearch] = createSignal("")
  const [filter, setFilter] = createSignal<RequirementFilter>("all")

  const [data, { refetch }] = createResource(() => props.project ?? "", (project) => backend.listRequirements(project))

  const filtered = createMemo(() => {
    const all = data() ?? []
    const q = search().toLowerCase().trim()
    const scoped = all.filter((r) => {
      const locked = workflow.isLocked(props.project ?? "", r.id)
      if (filter() === "all") return true
      if (filter() === "locked") return locked
      if (filter() === "doing") return r.status === "doing" || r.status === "waiting_review"
      if (filter() === "done") return r.status === "done"
      return r.status === "todo" && !locked
    })
    if (!q) return scoped
    return scoped.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    )
  })

  return (
    <div class="flex flex-col h-full min-h-0">
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
          <For each={FILTERS}>
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

        {/* No project selected */}
        <Show when={!props.project && !data.loading}>
          <div class="flex flex-col items-center gap-3 py-16 px-4 text-center">
            <Icon name="folder" size="large" class="text-[var(--v2-text-text-faint)]" />
            <div class="flex flex-col gap-1">
              <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">未选择项目</p>
              <p class="text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                {language.t("requirements.list.noProject")}
              </p>
            </div>
          </div>
        </Show>

        {/* Empty */}
        <Show when={props.project && !data.loading && !data.error && filtered().length === 0}>
          <div class="flex flex-col items-center gap-2 py-12">
            <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">{language.t("requirements.list.empty")}</p>
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
                    <Show
                      when={workflow.isLocked(props.project ?? "", req.id)}
                      fallback={<StatusBadge status={req.status} />}
                    >
                      <span class="inline-block rounded-[3px] bg-[var(--v2-green-400)]/15 px-1.5 py-0.5 text-[10px] font-[440] text-[var(--v2-green-600)]">
                        已锁定
                      </span>
                    </Show>
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
