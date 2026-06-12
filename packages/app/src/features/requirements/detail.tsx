import { For, Show, createMemo, createResource, createSignal, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { useRequirements, generatePrompt, buildRawContent } from "./provider"
import { useRequirementLinks } from "./services/requirementLinkStore"
import { SessionPicker } from "./session-picker"
import { PromptPanel } from "./prompt-panel"
import type { RequirementItem, RequirementSendMode, ExecutionStatus, LinkStatus } from "./types"
import type { Session } from "@opencode-ai/sdk/v2/client"

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
  waiting_review: "bg-[var(--v2-color-yellow-400)]/15 text-[var(--v2-color-yellow-400)]",
  done: "bg-[var(--v2-color-green-400)]/30 text-[var(--v2-color-green-400)]",
  failed: "bg-[var(--v2-color-red-400)]/15 text-[var(--v2-color-red-400)]",
}

interface ProjectContext {
  server: ServerConnection.Key
  directory: string
}

// ── Component ───────────────────────────────────────────────────────────────

export const RequirementDetail: Component<{
  id: string
  onBack: () => void
}> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const server = useServer()
  const serverSync = useServerSync()
  const navigate = useNavigate()
  const linkStore = useRequirementLinks()

  const [data] = createResource(() => props.id, (id) => backend.getRequirementDetail(id))
  const [generatedPrompt, setGeneratedPrompt] = createSignal<string | null>(null)
  const [showPicker, setShowPicker] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [showCreateConfirm, setShowCreateConfirm] = createSignal(false)

  function getProjectContext(): ProjectContext | null {
    const last = server.projects.last()
    if (last) return { server: server.key, directory: last }
    const list = server.projects.list()
    if (list.length > 0) return { server: server.key, directory: list[0].worktree }
    return null
  }

  const projectDir = createMemo(() => getProjectContext()?.directory ?? "")

  // Links for the current requirement, scoped to current project.
  // Exclude links with empty sessionId (pending/not-yet-created sessions).
  const reqLinks = createMemo(() =>
    linkStore.getLinksByRequirement(projectDir(), props.id).filter((l) => !!l.sessionId),
  )
  const hasLinks = createMemo(() => reqLinks().length > 0)
  const primaryLink = createMemo(() => linkStore.getPrimaryLink(projectDir(), props.id))

  // ── Content builders ─────────────────────────────────────────────────────

  function getRawContent(): string {
    return buildRawContent(data()!)
  }

  function doGeneratePrompt(): string {
    const req = data()!
    const prompt = generatePrompt(req)
    setGeneratedPrompt(prompt)
    return prompt
  }

  // ── Create Requirement Session (primary action) ──────────────────────────

  /** Build the session title with sequence suffix for multiple sessions */
  function buildSessionTitle(): string {
    const req = data()!
    const count = reqLinks().length
    if (count === 0) return `${req.id} ${req.title}`
    return `${req.id} ${req.title} (${count + 1})`
  }

  function doCreateSession() {
    if (creating()) return
    const req = data()!
    if (!req) return
    const ctx = getProjectContext()
    if (!ctx) { showToast({ title: language.t("requirements.action.noProjectContext"), variant: "default" }); return }

    setCreating(true)
    try {
      const content = generatedPrompt() || getRawContent()
      const title = buildSessionTitle()

      // Don't create a link yet — the session doesn't exist.
      // The link will be created when the user submits the prompt and the
      // session is actually created by the server. For now, just navigate
      // to the new-session page with the content pre-filled.

      navigate(`/${base64Encode(ctx.directory)}/session?prompt=${encodeURIComponent(content)}`)
    } finally {
      setCreating(false)
    }
  }

  function handleCreateSession() {
    // If already has linked sessions, confirm before creating another
    if (reqLinks().length > 0) {
      setShowCreateConfirm(true)
      return
    }
    doCreateSession()
  }

  // ── Add to Existing Session (picker) ─────────────────────────────────────

  function handleAddToExisting() {
    setShowPicker(true)
  }

  function handlePickerSelect(session: Session) {
    setShowPicker(false)
    const req = data()!
    if (!req) return
    const ctx = getProjectContext()
    if (!ctx) return

    const content = generatedPrompt() || getRawContent()
    const mode: RequirementSendMode = generatedPrompt() ? "prompt" : "raw"

    // Create link
    linkStore.createLink({
      projectId: ctx.directory,
      projectPath: ctx.directory,
      requirementId: req.id,
      requirementTitle: req.title,
      sessionId: session.id,
      sessionTitle: session.title,
      sessionDirectory: session.directory,
      sourceMode: mode,
      status: "filled_to_session",
      content,
    })

    // Navigate with ?prompt= to fill content into the existing session
    navigate(`/${base64Encode(session.directory)}/session/${session.id}?prompt=${encodeURIComponent(content)}`)
  }

  function handlePickerCreateNew() {
    setShowPicker(false)
    handleCreateSession()
  }

  // ── Linked Session Actions ───────────────────────────────────────────────

  function handleOpenSession(link: { sessionId: string; sessionDirectory?: string; projectPath?: string }) {
    const dir = link.sessionDirectory || link.projectPath || projectDir()
    if (!dir || !link.sessionId) return
    navigate(`/${base64Encode(dir)}/session/${link.sessionId}`)
  }

  function handleUpdateLinkStatus(linkId: string, status: LinkStatus) {
    linkStore.updateLinkStatus(linkId, status)
  }

  function handleUnlink(linkId: string) {
    linkStore.removeLink(linkId)
    showToast({ title: language.t("requirements.detail.unlinked"), variant: "success" })
  }

  // ── Helper: get other links for the same session (different requirement) ─

  function getOtherReqLinksForSession(sessionId: string) {
    const allSessionLinks = linkStore.getLinksBySession(projectDir(), sessionId)
    return allSessionLinks.filter((l) => l.requirementId !== props.id)
  }

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* Session Picker Dialog */}
      <Show when={showPicker()}>
        <SessionPicker
          projectId={projectDir()}
          requirementId={props.id}
          requirementTitle={data()?.title ?? ""}
          currentReqId={props.id}
          onSelect={handlePickerSelect}
          onCancel={() => setShowPicker(false)}
          onCreateNew={handlePickerCreateNew}
        />
      </Show>

      {/* Header */}
      <div class="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
        <button type="button" onClick={props.onBack} class="flex items-center gap-1 text-[13px] text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)] transition-colors">
          <Icon name="chevron-down" size="small" class="rotate-90" />
          {language.t("requirements.detail.back")}
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <Show when={data.loading && !data()}>
          <div class="flex flex-col gap-3">
            <div class="h-6 w-2/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
            <div class="h-4 w-1/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
            <div class="h-32 rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
          </div>
        </Show>

        <Show when={!data.loading && !data()}>
          <div class="flex flex-col items-center gap-3 py-12">
            <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">{language.t("requirements.detail.notFound")}</p>
          </div>
        </Show>

        <Show when={data()}>
          {(req) => (
            <div class="flex flex-col gap-4">
              {/* Title + meta */}
              <div>
                <div class="flex items-center gap-2 mb-2 flex-wrap">
                  <h2 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">{req().title}</h2>
                  <span class={`rounded-[3px] px-1.5 py-0.5 text-[11px] font-[440] capitalize ${STATUS_COLORS[req().status]}`}>
                    {language.t(`requirements.status.${req().status}`)}
                  </span>
                </div>
                <div class="flex items-center gap-3 flex-wrap text-[12px] text-[var(--v2-text-text-muted)]">
                  <span>{req().id}</span>
                  <span class="flex items-center gap-1">
                    <span class={`inline-block size-2 rounded-full ${PRIORITY_COLORS[req().priority]}`} />
                    {language.t(`requirements.priority.${req().priority}`)}
                  </span>
                  <span>{req().source}</span>
                  {req().module && <span>Module: {req().module}</span>}
                </div>
              </div>

              {/* Description */}
              <div>
                <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-1.5">Description</h3>
                <p class="text-[13px] text-[var(--v2-text-text-muted)] leading-relaxed">{req().description}</p>
              </div>

              {/* Acceptance Criteria */}
              <div>
                <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-1.5">Acceptance Criteria</h3>
                <ul class="space-y-1">
                  <For each={req().acceptanceCriteria}>
                    {(criterion, index) => (
                      <li class="flex items-start gap-2 text-[13px] text-[var(--v2-text-text-muted)]">
                        <span class="shrink-0 text-[var(--v2-text-text-faint)] mt-0.5">{index() + 1}.</span>
                        <span>{criterion}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>

              {/* Tags */}
              <Show when={req().tags && req().tags!.length > 0}>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <For each={req().tags}>{(tag) => (
                    <span class="rounded-[3px] px-1.5 py-0.5 text-[11px] bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-muted)]">{tag}</span>
                  )}</For>
                </div>
              </Show>

              {/* ── Primary Actions ──────────────────────────────────────── */}
              <div class="pt-2">
                <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-2">
                  {language.t("requirements.action.section")}
                </h3>
                <div class="flex items-center gap-2 flex-wrap">
                  <ButtonV2
                    size="small"
                    icon="grid-plus"
                    disabled={creating()}
                    onClick={handleCreateSession}
                  >
                    {creating()
                      ? language.t("requirements.action.creating")
                      : hasLinks()
                        ? language.t("requirements.action.createAnotherSession")
                        : language.t("requirements.action.createRequirementSession")
                    }
                  </ButtonV2>
                  <ButtonV2 size="small" variant="ghost" icon="plus" onClick={handleAddToExisting}>
                    {language.t("requirements.action.addToExistingSession")}
                  </ButtonV2>
                </div>
              </div>

              {/* ── Create Another Session confirmation dialog ──────────── */}
              <Show when={showCreateConfirm()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                  <div class="bg-[var(--v2-background-bg-base)] rounded-[10px] border border-[var(--v2-border-border-base)] shadow-[var(--v2-elevation-overlay)] w-[380px] p-4 flex flex-col gap-3">
                    <p class="text-[13px] text-[var(--v2-text-text-base)]">
                      {language.t("requirements.action.createAnotherConfirm", { count: reqLinks().length })}
                    </p>
                    <div class="flex items-center gap-2 justify-end">
                      <ButtonV2 size="small" variant="ghost" onClick={() => setShowCreateConfirm(false)}>
                        {language.t("requirements.picker.cancel")}
                      </ButtonV2>
                      <ButtonV2 size="small" onClick={() => { setShowCreateConfirm(false); doCreateSession() }}>
                        {language.t("requirements.action.continueCreate")}
                      </ButtonV2>
                    </div>
                  </div>
                </div>
              </Show>

              {/* ── Linked Sessions ──────────────────────────────────────── */}
              <Show when={hasLinks()}>
                <div>
                  <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-2">
                    {language.t("requirements.detail.linkedSessions")} · {reqLinks().length}
                  </h3>
                  <div class="flex flex-col gap-2">
                    <For each={reqLinks()}>
                      {(link) => {
                        const otherReqs = getOtherReqLinksForSession(link.sessionId)
                        return (
                          <div class="rounded-[8px] bg-[var(--v2-background-bg-deep)] border border-[var(--v2-border-border-base)] p-3 flex flex-col gap-2">
                            {/* Session title + status */}
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">
                                {link.sessionTitle || `Session ${link.sessionId.slice(0, 8)}`}
                              </span>
                              <span class={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] ${EXECUTION_STATUS_COLORS[link.status as unknown as ExecutionStatus]}`}>
                                {language.t(`requirements.execution.status.${link.status}`)}
                              </span>
                            </div>
                            {/* Meta row: source + time */}
                            <div class="flex items-center gap-3 text-[11px] text-[var(--v2-text-text-faint)]">
                              <span>{language.t("requirements.detail.source")}: {link.sourceMode === "raw" ? language.t("requirements.detail.sourceRaw") : language.t("requirements.detail.sourcePrompt")}</span>
                              <span>{language.t("requirements.detail.created")}: {new Date(link.createdAt).toLocaleString()}</span>
                            </div>
                            {/* Other requirements in same session */}
                            <Show when={otherReqs.length > 0}>
                              <div class="text-[11px] text-[var(--v2-text-text-faint)]">
                                {language.t("requirements.detail.sessionHasOtherReqs", { count: otherReqs.length })}:
                                <For each={otherReqs}>{(r) => (
                                  <span class="ml-1 text-[var(--v2-color-blue-400)]">{r.requirementId}</span>
                                )}</For>
                              </div>
                            </Show>
                            {/* Actions */}
                            <div class="flex items-center gap-2 flex-wrap pt-1">
                              <ButtonV2 size="small" icon="open-link" onClick={() => handleOpenSession(link)}>
                                {language.t("requirements.detail.openLinkedSession")}
                              </ButtonV2>
                              <ButtonV2
                                size="small"
                                variant={link.status === "implementing" ? undefined : "ghost"}
                                onClick={() => handleUpdateLinkStatus(link.id, "implementing")}
                              >
                                {language.t("requirements.detail.markImplementing")}
                              </ButtonV2>
                              <ButtonV2
                                size="small"
                                variant={link.status === "waiting_review" ? undefined : "ghost"}
                                onClick={() => handleUpdateLinkStatus(link.id, "waiting_review")}
                              >
                                {language.t("requirements.detail.markWaitingReview")}
                              </ButtonV2>
                              <ButtonV2
                                size="small"
                                variant={link.status === "done" ? undefined : "ghost"}
                                onClick={() => handleUpdateLinkStatus(link.id, "done")}
                              >
                                {language.t("requirements.detail.markDone")}
                              </ButtonV2>
                              <ButtonV2
                                size="small"
                                variant={link.status === "failed" ? undefined : "ghost"}
                                onClick={() => handleUpdateLinkStatus(link.id, "failed")}
                              >
                                {language.t("requirements.detail.markFailed")}
                              </ButtonV2>
                              <ButtonV2 size="small" variant="ghost" onClick={() => handleUnlink(link.id)}>
                                {language.t("requirements.detail.unlinkSession")}
                              </ButtonV2>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              {/* ── AI Enhanced Prompt Actions ───────────────────────────── */}
              <div>
                <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-2">
                  {language.t("requirements.action.promptSection")}
                </h3>
                <Show when={!generatedPrompt()}>
                  <ButtonV2 size="small" icon="wand" onClick={doGeneratePrompt}>
                    {language.t("requirements.action.generatePrompt")}
                  </ButtonV2>
                </Show>
                <Show when={generatedPrompt()}>
                  <div class="flex flex-col gap-3">
                    <PromptPanel prompt={generatedPrompt()!} />
                    <ButtonV2 size="small" icon="edit" onClick={async () => {
                      try { await navigator.clipboard.writeText(generatedPrompt()!); showToast({ title: language.t("requirements.prompt.copied"), variant: "success" }) }
                      catch { showToast({ title: language.t("requirements.prompt.copyFailed"), variant: "error" }) }
                    }}>
                      {language.t("requirements.action.copyPrompt")}
                    </ButtonV2>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
