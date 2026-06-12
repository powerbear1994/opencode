import { For, Show, createResource, createSignal, type Component } from "solid-js"
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
import { useExecutionStore } from "./services/executionStore"
import { setSessionDraft } from "./services/sessionDraftStore"
import { PromptPanel } from "./prompt-panel"
import type { RequirementItem, RequirementSendMode } from "./types"

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

/** Resolved project context needed for session actions */
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
  const exec = useExecutionStore()

  const [data] = createResource(() => props.id, (id) => backend.getRequirementDetail(id))

  // Prompt generation is explicit — not automatic
  const [generatedPrompt, setGeneratedPrompt] = createSignal<string | null>(null)

  // ── Project context ──────────────────────────────────────────────────────

  /** Resolve the current project context for session actions */
  function getProjectContext(): ProjectContext | null {
    // 1. Try last-touched project (from server state)
    const last = server.projects.last()
    if (last) {
      return { server: server.key, directory: last }
    }

    // 2. Fall back to any open project
    const list = server.projects.list()
    if (list.length > 0) {
      return { server: server.key, directory: list[0].worktree }
    }

    return null
  }

  // ── Content builders ─────────────────────────────────────────────────────

  function getRawContent(): string {
    const req = data()!
    return buildRawContent(req)
  }

  function doGeneratePrompt(): string {
    const req = data()!
    const prompt = generatePrompt(req)
    setGeneratedPrompt(prompt)

    // Record prompt generation
    exec.upsertRecord({
      requirementId: req.id,
      projectId: getProjectContext()?.directory ?? "",
      sourceMode: "prompt",
      content: prompt,
      status: "prompt_generated",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    return prompt
  }

  // ── Shared helpers for session actions ───────────────────────────────────

  /**
   * Fill content into the top session of the current project.
   * The "top session" is the first session in the sidebar's sorted list
   * (most recently updated root, non-archived, non-child session).
   */
  function fillIntoTopSession(content: string, status: "raw_filled_to_session" | "prompt_filled_to_session") {
    const req = data()!
    if (!req) return

    const ctx = getProjectContext()
    if (!ctx) {
      showToast({ title: language.t("requirements.action.noProjectContext"), variant: "default" })
      return
    }

    // Get sorted root sessions for the project directory
    const [store] = serverSync.child(ctx.directory, { bootstrap: true })
    const sessions = sortedRootSessions(store, Date.now())

    if (sessions.length === 0) {
      showToast({ title: language.t("requirements.action.noSessionsInProject"), variant: "default" })
      return
    }

    const topSession = sessions[0]

    // Save draft so the session page fills the input on mount
    setSessionDraft(topSession.id, content)

    // Save execution record BEFORE navigation (navigation unmounts this component)
    exec.upsertRecord({
      requirementId: req.id,
      projectId: ctx.directory,
      sessionId: topSession.id,
      sourceMode: status.startsWith("raw_") ? "raw" : "prompt",
      content,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Navigate to the top session's workspace page
    navigate(`/${base64Encode(topSession.directory)}/session/${topSession.id}`)
  }

  /**
   * Navigate to the project's new-session page with content pre-filled.
   * The existing session.tsx effect reads ?prompt= from the URL and fills
   * the input for new sessions (when params.id is absent).
   */
  function createSessionWithMode(
    mode: RequirementSendMode,
    content: string,
    status: "raw_session_created" | "prompt_session_created",
  ) {
    const req = data()!
    if (!req) return
    const ctx = getProjectContext()
    if (!ctx) {
      showToast({ title: language.t("requirements.action.noProjectContext"), variant: "default" })
      return
    }

    // Save execution record BEFORE navigation (navigation unmounts this component)
    exec.upsertRecord({
      requirementId: req.id,
      projectId: ctx.directory,
      sourceMode: mode,
      content,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Navigate to the project's new-session page. The ?prompt= param is read
    // by session.tsx's existing effect to pre-fill the input for new sessions.
    navigate(`/${base64Encode(ctx.directory)}/session?prompt=${encodeURIComponent(content)}`)
  }

  // ── Raw Requirement Actions ──────────────────────────────────────────────

  function handleFillRaw() {
    fillIntoTopSession(getRawContent(), "raw_filled_to_session")
  }

  function handleCreateSessionRaw() {
    createSessionWithMode("raw", getRawContent(), "raw_session_created")
  }

  // ── Prompt Actions (only available after generation) ─────────────────────

  async function handleCopyPrompt() {
    const prompt = generatedPrompt()
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      showToast({ title: language.t("requirements.prompt.copied"), variant: "success" })
    } catch {
      showToast({ title: language.t("requirements.prompt.copyFailed"), variant: "error" })
    }
  }

  function handleFillPrompt() {
    const prompt = generatedPrompt()
    if (!prompt) return
    fillIntoTopSession(prompt, "prompt_filled_to_session")
  }

  function handleCreateSessionPrompt() {
    const prompt = generatedPrompt()
    if (!prompt) return
    createSessionWithMode("prompt", prompt, "prompt_session_created")
  }

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* Header */}
      <div class="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={props.onBack}
          class="flex items-center gap-1 text-[13px] text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)] transition-colors"
        >
          <Icon name="chevron-down" size="small" class="rotate-90" />
          {language.t("requirements.detail.back")}
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {/* Loading */}
        <Show when={data.loading && !data()}>
          <div class="flex flex-col gap-3">
            <div class="h-6 w-2/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
            <div class="h-4 w-1/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
            <div class="h-32 rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
          </div>
        </Show>

        {/* Not found */}
        <Show when={!data.loading && !data()}>
          <div class="flex flex-col items-center gap-3 py-12">
            <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">{language.t("requirements.detail.notFound")}</p>
          </div>
        </Show>

        {/* Found */}
        <Show when={data()}>
          {(req) => (
            <div class="flex flex-col gap-4">
              {/* Title + meta */}
              <div>
                <div class="flex items-center gap-2 mb-2 flex-wrap">
                  <h2 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">{req().title}</h2>
                  <span
                    class={`rounded-[3px] px-1.5 py-0.5 text-[11px] font-[440] capitalize ${STATUS_COLORS[req().status]}`}
                  >
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
                  <For each={req().tags}>
                    {(tag) => (
                      <span class="rounded-[3px] px-1.5 py-0.5 text-[11px] bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-muted)]">
                        {tag}
                      </span>
                    )}
                  </For>
                </div>
              </Show>

              {/* ── Raw Requirement Actions ──────────────────────────── */}
              <div class="pt-2">
                <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-2">
                  {language.t("requirements.action.rawSection")}
                </h3>
                <div class="flex items-center gap-2 flex-wrap">
                  <ButtonV2 size="small" icon="plus" onClick={handleFillRaw}>
                    {language.t("requirements.action.fillRaw")}
                  </ButtonV2>
                  <ButtonV2 size="small" variant="ghost" icon="grid-plus" onClick={handleCreateSessionRaw}>
                    {language.t("requirements.action.createSessionRaw")}
                  </ButtonV2>
                </div>
              </div>

              {/* ── AI Enhanced Prompt Actions ───────────────────────── */}
              <div>
                <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-2">
                  {language.t("requirements.action.promptSection")}
                </h3>

                {/* Initial state: only "Generate" button */}
                <Show when={!generatedPrompt()}>
                  <ButtonV2 size="small" icon="wand" onClick={doGeneratePrompt}>
                    {language.t("requirements.action.generatePrompt")}
                  </ButtonV2>
                </Show>

                {/* Generated state: preview + actions */}
                <Show when={generatedPrompt()}>
                  <div class="flex flex-col gap-3">
                    <PromptPanel prompt={generatedPrompt()!} />
                    <div class="flex items-center gap-2 flex-wrap">
                      <ButtonV2 size="small" icon="edit" onClick={handleCopyPrompt}>
                        {language.t("requirements.action.copyPrompt")}
                      </ButtonV2>
                      <ButtonV2 size="small" variant="ghost" icon="plus" onClick={handleFillPrompt}>
                        {language.t("requirements.action.fillPrompt")}
                      </ButtonV2>
                      <ButtonV2 size="small" variant="ghost" icon="grid-plus" onClick={handleCreateSessionPrompt}>
                        {language.t("requirements.action.createSessionPrompt")}
                      </ButtonV2>
                    </div>
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
