import { For, Show, createMemo, createResource, createSignal, type Component } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useRequirements } from "./provider"
import { useExecutionStore } from "./services/executionStore"
import type { ExecutionStatus, RequirementItem } from "./types"

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<RequirementItem["status"], string> = {
  todo: "bg-[var(--v2-text-text-muted)]/15 text-[var(--v2-text-text-muted)]",
  doing: "bg-[var(--v2-color-blue-400)]/15 text-[var(--v2-color-blue-400)]",
  done: "bg-[var(--v2-color-green-400)]/15 text-[var(--v2-color-green-400)]",
}

const PRIORITY_COLORS: Record<RequirementItem["priority"], string> = {
  high: "bg-[var(--v2-color-red-400)]",
  medium: "bg-[var(--v2-color-yellow-400)]",
  low: "bg-[var(--v2-text-text-faint)]",
}

const EXECUTION_STATUS_COLORS: Record<ExecutionStatus, string> = {
  not_started: "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]",
  prompt_created: "bg-[var(--v2-color-blue-400)]/15 text-[var(--v2-color-blue-400)]",
  prompt_generated: "bg-[var(--v2-color-blue-400)]/15 text-[var(--v2-color-blue-400)]",
  filled_to_chat: "bg-[var(--v2-color-yellow-400)]/15 text-[var(--v2-color-yellow-400)]",
  raw_filled_to_session: "bg-[var(--v2-color-yellow-400)]/15 text-[var(--v2-color-yellow-400)]",
  prompt_filled_to_session: "bg-[var(--v2-color-yellow-400)]/15 text-[var(--v2-color-yellow-400)]",
  session_created: "bg-[var(--v2-color-green-400)]/15 text-[var(--v2-color-green-400)]",
  raw_session_created: "bg-[var(--v2-color-green-400)]/15 text-[var(--v2-color-green-400)]",
  prompt_session_created: "bg-[var(--v2-color-green-400)]/15 text-[var(--v2-color-green-400)]",
  implementing: "bg-[var(--v2-color-purple-400)]/15 text-[var(--v2-color-purple-400)]",
  done: "bg-[var(--v2-color-green-400)]/30 text-[var(--v2-color-green-400)]",
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return iso
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export const RequirementList: Component<{
  onSelect: (id: string) => void
}> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const exec = useExecutionStore()
  const [search, setSearch] = createSignal("")

  const [data, { refetch }] = createResource(() => backend.listRequirements())

  const filtered = createMemo(() => {
    const all = data() ?? []
    const q = search().toLowerCase().trim()
    if (!q) return all
    return all.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
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
            class="w-full h-8 pl-8 pr-3 rounded-[6px] bg-[var(--v2-background-bg-layer-01)] text-[13px] text-[var(--v2-text-text-base)] placeholder:text-[var(--v2-text-text-faint)] outline-none border border-transparent focus:border-[var(--v2-color-blue-400)] transition-colors"
          />
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

        {/* Empty */}
        <Show when={!data.loading && !data.error && filtered().length === 0}>
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
                  class="w-full text-left p-3 rounded-[8px] bg-[var(--v2-background-bg-deep)] hover:bg-[var(--v2-background-bg-layer-01)] transition-colors cursor-pointer border border-transparent hover:border-[var(--v2-border-border-base)]"
                >
                  {/* Title row */}
                  <div class="flex items-start justify-between gap-2 mb-1.5">
                    <span class="text-[13px] font-[530] text-[var(--v2-text-text-base)] truncate">{req.title}</span>
                    <span class="shrink-0 text-[11px] font-[440] text-[var(--v2-text-text-faint)]">
                      {formatDate(req.updatedAt)}
                    </span>
                  </div>

                  {/* Badges row */}
                  <div class="flex items-center gap-2 flex-wrap">
                    {/* ID */}
                    <span class="text-[11px] font-[440] text-[var(--v2-text-text-faint)]">{req.id}</span>

                    {/* Status */}
                    <span
                      class={`inline-block rounded-[3px] px-1.5 py-0.5 text-[11px] font-[440] capitalize ${STATUS_COLORS[req.status]}`}
                    >
                      {language.t(`requirements.status.${req.status}`)}
                    </span>

                    {/* Priority dot */}
                    <span class="flex items-center gap-1">
                      <span class={`inline-block size-2 rounded-full ${PRIORITY_COLORS[req.priority]}`} />
                      <span class="text-[11px] text-[var(--v2-text-text-faint)] capitalize">
                        {language.t(`requirements.priority.${req.priority}`)}
                      </span>
                    </span>

                    {/* Execution status */}
                    <Show when={exec.statusFor(req.id) !== "not_started"}>
                      <span
                        class={`inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] ${EXECUTION_STATUS_COLORS[exec.statusFor(req.id)]}`}
                      >
                        {language.t(`requirements.execution.status.${exec.statusFor(req.id)}`)}
                      </span>
                    </Show>

                    {/* Linked session indicator */}
                    <Show when={exec.getRecord(req.id)?.sessionId}>
                      <span class="inline-flex items-center gap-1 text-[10px] text-[var(--v2-text-text-faint)]">
                        <span class="inline-block size-1.5 rounded-full bg-[var(--v2-color-green-400)]" />
                        {language.t("requirements.execution.linkedSession")}
                      </span>
                    </Show>

                    {/* Tags */}
                    <For each={req.tags?.slice(0, 3)}>
                      {(tag) => (
                        <span class="inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-muted)]">
                          {tag}
                        </span>
                      )}
                    </For>
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
