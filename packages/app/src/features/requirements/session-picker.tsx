import { For, Show, createMemo, createSignal, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { useRequirementLinks } from "./services/requirementLinkStore"
import type { Session } from "@opencode-ai/sdk/v2/client"

// ── Component ───────────────────────────────────────────────────────────────

export const SessionPicker: Component<{
  projectId: string
  requirementId: string
  requirementTitle: string
  currentReqId: string
  agent?: string
  onSelect: (session: Session) => void
  onCancel: () => void
  onCreateNew: () => void
}> = (props) => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const linkStore = useRequirementLinks()

  const [store] = serverSync.child(props.projectId, { bootstrap: true })
  const sessions = createMemo(() =>
    sortedRootSessions(store, Date.now()).filter((session) => !props.agent || session.agent === props.agent),
  )

  const [confirmingSession, setConfirmingSession] = createSignal<Session | null>(null)

  const linkedCounts = createMemo(() => {
    const map = new Map<string, { count: number; reqs: string }>()
    for (const s of sessions()) {
      const links = linkStore.getLinksBySession(props.projectId, s.id)
      if (links.length > 0) {
        const reqs = links.map((l) => `${l.requirementId} ${l.requirementTitle}`).join(", ")
        map.set(s.id, { count: links.length, reqs })
      }
    }
    return map
  })

  function handleSessionClick(session: Session) {
    const info = linkedCounts().get(session.id)
    if (info && info.count > 0) {
      // Show confirmation before adding to a session with existing links
      setConfirmingSession(session)
    } else {
      props.onSelect(session)
    }
  }

  function handleConfirm() {
    const session = confirmingSession()
    if (session) {
      setConfirmingSession(null)
      props.onSelect(session)
    }
  }

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        class="bg-[var(--v2-background-bg-base)] rounded-[10px] border border-[var(--v2-border-border-base)] shadow-[var(--v2-elevation-overlay)] w-full max-w-[400px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--v2-border-border-base)]">
          <Show
            when={!confirmingSession()}
            fallback={
              <span class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">
                {language.t("requirements.picker.confirmTitle")}
              </span>
            }
          >
            <span class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">
              {language.t("requirements.picker.title")}
            </span>
          </Show>
          <button
            type="button"
            onClick={props.onCancel}
            class="text-[var(--v2-text-text-faint)] hover:text-[var(--v2-text-text-base)]"
          >
            <Icon name="close" size="small" />
          </button>
        </div>

        {/* Body */}
        <div class="flex-1 min-h-0 overflow-y-auto p-3">
          <Show
            when={!confirmingSession()}
            fallback={
              <div class="flex flex-col gap-3">
                <p class="text-[13px] text-[var(--v2-text-text-muted)]">
                  {language.t("requirements.picker.sessionHasLinks", {
                    reqs: linkedCounts().get(confirmingSession()!.id)?.reqs ?? "",
                  })}
                </p>
                <p class="text-[13px] text-[var(--v2-text-text-muted)]">
                  {language.t("requirements.picker.confirmAdd", {
                    req: `${props.currentReqId} ${props.requirementTitle}`,
                  })}
                </p>
                <div class="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <ButtonV2 size="small" variant="ghost" onClick={() => setConfirmingSession(null)}>
                    {language.t("requirements.picker.cancel")}
                  </ButtonV2>
                  <ButtonV2 size="small" onClick={handleConfirm}>
                    {language.t("requirements.picker.addToSession")}
                  </ButtonV2>
                  <ButtonV2 size="small" variant="ghost" onClick={props.onCreateNew}>
                    {language.t("requirements.picker.createNew")}
                  </ButtonV2>
                </div>
              </div>
            }
          >
            {/* Session list */}
            <Show
              when={sessions().length > 0}
              fallback={
                <p class="text-[13px] text-[var(--v2-text-text-muted)] text-center py-8">
                  {language.t("requirements.picker.noSessions")}
                </p>
              }
            >
              <div class="flex flex-col gap-1">
                <For each={sessions()}>
                  {(session) => {
                    const info = linkedCounts().get(session.id)
                    return (
                      <button
                        type="button"
                        onClick={() => handleSessionClick(session)}
                        class="w-full text-left px-3 py-2.5 rounded-[6px] hover:bg-[var(--v2-background-bg-layer-01)] transition-colors flex items-center gap-3"
                      >
                        <span class="text-[13px] text-[var(--v2-text-text-base)] flex-1 truncate">
                          {session.title || "Untitled session"}
                        </span>
                        <Show when={info}>
                          <span class="text-[11px] text-[var(--v2-text-text-faint)] shrink-0">
                            {language.t("requirements.picker.linkedCount", { count: info!.count })}
                          </span>
                        </Show>
                        <Icon name="chevron-down" size="small" class="rotate-[-90deg] text-[var(--v2-text-text-faint)]" />
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        {/* Footer (only in list mode) */}
        <Show when={!confirmingSession()}>
          <div class="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--v2-border-border-base)]">
            <ButtonV2 size="small" variant="ghost" onClick={props.onCreateNew}>
              {language.t("requirements.picker.createNewInstead")}
            </ButtonV2>
          </div>
        </Show>
      </div>
    </div>
  )
}
