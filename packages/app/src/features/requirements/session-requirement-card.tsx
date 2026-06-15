import { For, Show, createMemo, createSignal, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { useRequirementLinks } from "./services/requirementLinkStore"
import type { LinkStatus } from "./types"

// ── Status options for the button group ────────────────────────────────────

const STATUS_OPTIONS: LinkStatus[] = ["implementing", "waiting_review", "done", "failed"]

// Simple inline status color lookup — avoids depending on ExecutionStatus type
function statusColor(status: string): string {
  const map: Record<string, string> = {
    not_started: "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]",
    filled_to_session: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
    session_created: "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]",
    implementing: "bg-[var(--v2-purple-400)]/15 text-[var(--v2-purple-600)]",
    waiting_review: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
    done: "bg-[var(--v2-green-400)]/30 text-[var(--v2-green-700)]",
    failed: "bg-[var(--v2-red-400)]/15 text-[var(--v2-red-600)]",
  }
  return map[status] ?? map.not_started
}

// ── Component ───────────────────────────────────────────────────────────────

export const SessionRequirementCard: Component<{
  projectId: string
  sessionId: string
}> = (props) => {
  const language = useLanguage()
  const navigate = useNavigate()
  const linkStore = useRequirementLinks()

  // Safe accessor — returns empty array if store access fails
  const links = createMemo(() => {
    try {
      return linkStore.getLinksBySession(props.projectId, props.sessionId)
    } catch {
      return []
    }
  })

  const hasLinks = createMemo(() => links().length > 0)
  const [expanded, setExpanded] = createSignal(false)
  const isMulti = createMemo(() => links().length > 1)
  const shouldExpand = createMemo(() => expanded() || !isMulti())

  return (
    <Show when={hasLinks()}>
      <div class="shrink-0 mx-4 mt-1">
        <div class="rounded-[6px] bg-[var(--v2-background-bg-deep)] border border-[var(--v2-border-border-base)] px-3 py-1.5 flex flex-col gap-1">
          {/* Header row */}
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-[530] text-[var(--v2-text-text-muted)]">
              {language.t("requirements.card.relatedRequirements")}
              <Show when={isMulti()}> · {links().length}</Show>
            </span>
            <Show when={isMulti() && !expanded()}>
              <span class="text-[11px] text-[var(--v2-text-text-faint)] truncate">
                <For each={links()}>{(l, i) => (
                  <>{i() > 0 ? ", " : ""}{l.requirementId}</>
                )}</For>
              </span>
            </Show>
            <span class="flex-1" />
            <Show when={isMulti()}>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                class="text-[11px] text-[var(--v2-blue-400)] hover:underline shrink-0"
              >
                {expanded() ? language.t("requirements.card.collapse") : language.t("requirements.card.expand")}
              </button>
            </Show>
          </div>

          {/* Expanded list */}
          <Show when={shouldExpand()}>
            <div class="flex flex-col gap-1">
              <For each={links()}>
                {(link) => (
                  <div class="flex items-center gap-2">
                    <span class="text-[11px] font-[530] text-[var(--v2-blue-400)] shrink-0 w-16">
                      {link.requirementId}
                    </span>
                    <span class="text-[12px] text-[var(--v2-text-text-base)] min-w-0 truncate flex-1">
                      {link.requirementTitle || link.requirementId}
                    </span>
                    <span class={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] shrink-0 ${statusColor(link.status)}`}>
                      {language.t(`requirements.execution.status.${link.status}`)}
                    </span>
                    <div class="flex items-center gap-0.5 shrink-0">
                      {STATUS_OPTIONS.map((status) => (
                        <ButtonV2
                          size="small"
                          variant={link.status === status ? undefined : "ghost"}
                          onClick={() => linkStore.updateLinkStatus(link.id, status)}
                        >
                          {language.t(`requirements.card.status.${status}`)}
                        </ButtonV2>
                      ))}
                    </div>
                    <ButtonV2
                      size="small"
                      variant="ghost"
                      onClick={() =>
                        navigate(
                          `/requirements?project=${encodeURIComponent(props.projectId)}&selectedId=${encodeURIComponent(link.requirementId)}`,
                        )
                      }
                    >
                      {language.t("requirements.card.viewDetail")}
                    </ButtonV2>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
