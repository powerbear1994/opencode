import { For, Show, createEffect, createMemo, createResource, createSignal, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import { useRequirements, generatePrompt, buildRawContent } from "./provider"
import { useRequirementLinks, storePendingRequirementLink } from "./services/requirementLinkStore"
import { SessionPicker } from "./session-picker"
import { resolveRequirementProject } from "./project-context"
// import { PromptPanel } from "./prompt-panel"
import { StatusBadge, PriorityBadge } from "./badge"
import type { RequirementSendMode, ExecutionStatus, LinkStatus } from "./types"
import type { Session } from "@opencode-ai/sdk/v2/client"

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Maps both ExecutionStatus and LinkStatus values to badge colors */
const STATUS_COLORS_MAP: Record<string, string> = {
  not_started: "bg-[var(--v2-text-text-faint)]/15 text-[var(--v2-text-text-faint)]",
  prompt_created: "bg-[var(--v2-blue-400)]/15 text-[var(--v2-blue-400)]",
  prompt_generated: "bg-[var(--v2-blue-400)]/15 text-[var(--v2-blue-400)]",
  filled_to_chat: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
  filled_to_session: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
  raw_filled_to_session: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
  prompt_filled_to_session: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
  session_created: "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]",
  raw_session_created: "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]",
  prompt_session_created: "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]",
  implementing: "bg-[var(--v2-purple-400)]/15 text-[var(--v2-purple-600)]",
  waiting_review: "bg-[var(--v2-yellow-400)]/15 text-[var(--v2-yellow-600)]",
  done: "bg-[var(--v2-green-400)]/30 text-[var(--v2-green-700)]",
  failed: "bg-[var(--v2-red-400)]/15 text-[var(--v2-red-600)]",
}

/** Safe date formatter — returns "—" for invalid/missing dates */
function safeDate(iso: string | undefined | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString()
}

// ── Component ───────────────────────────────────────────────────────────────

export const RequirementDetail: Component<{
  id: string
  onBack: () => void
  project?: string
}> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const server = useServer()
  const navigate = useNavigate()
  const linkStore = useRequirementLinks()

  const [data, { refetch }] = createResource(() => props.id, (id) => backend.getRequirementDetail(id))
  const [generatedPrompt, setGeneratedPrompt] = createSignal<string | null>(null)
  const [showPicker, setShowPicker] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [showCreateConfirm, setShowCreateConfirm] = createSignal(false)
  const [sidebarVisible, setSidebarVisible] = createSignal(false)

  const projectDir = createMemo(
    () =>
      resolveRequirementProject(
        props.project,
        server.projects.list().map((project) => project.worktree),
        server.projects.last(),
      ) ?? "",
  )
  const hasProject = createMemo(() => projectDir().length > 0)

  const reqLinks = createMemo(() =>
    linkStore.getLinksByRequirement(projectDir(), props.id).filter((l) => !!l.sessionId),
  )
  const hasLinks = createMemo(() => reqLinks().length > 0)

  createEffect(() => {
    if (props.id && hasLinks()) setSidebarVisible(true)
  })

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

  // ── Create Requirement Session ──────────────────────────────────────────

  function doCreateSession() {
    if (creating()) return
    const req = data()!
    if (!req) return
    if (!hasProject()) {
      showToast({ title: language.t("requirements.action.noProjectContext"), variant: "default" })
      return
    }

    setCreating(true)
    try {
      const content = generatedPrompt() || getRawContent()
      const mode: RequirementSendMode = generatedPrompt() ? "prompt" : "raw"

      // Store a pending link so the session creation flow can bind it
      storePendingRequirementLink({
        projectId: projectDir(),
        projectPath: projectDir(),
        requirementId: req.id,
        requirementTitle: req.title,
        sourceMode: mode,
        content,
      })

      navigate(`/${base64Encode(projectDir())}/session?prompt=${encodeURIComponent(content)}`)
    } finally {
      setCreating(false)
    }
  }

  function handleCreateSession() {
    if (reqLinks().length > 0) {
      setShowCreateConfirm(true)
      return
    }
    doCreateSession()
  }

  // ── Add to Existing Session ─────────────────────────────────────────────

  function handleAddToExisting() {
    setShowPicker(true)
  }

  function handlePickerSelect(session: Session) {
    setShowPicker(false)
    const req = data()!
    if (!req) return
    if (!hasProject()) return

    const content = generatedPrompt() || getRawContent()
    const mode: RequirementSendMode = generatedPrompt() ? "prompt" : "raw"

    linkStore.createLink({
      projectId: projectDir(),
      projectPath: projectDir(),
      requirementId: req.id,
      requirementTitle: req.title,
      sessionId: session.id,
      sessionTitle: session.title,
      sessionDirectory: session.directory,
      sourceMode: mode,
      status: "filled_to_session",
      content,
    })

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

  /** Pick the most meaningful status across all linked sessions */
  function aggregateStatus(): LinkStatus | null {
    if (!hasLinks()) return null
    const statuses = reqLinks().map((l) => l.status)
    // Priority: implementing > waiting_review > session_created > filled_to_session > done > failed > not_started
    const order: LinkStatus[] = [
      "implementing",
      "waiting_review",
      "session_created",
      "filled_to_session",
      "done",
      "failed",
      "not_started",
    ]
    for (const s of order) {
      if (statuses.includes(s)) return s
    }
    return statuses[0]
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

      {/* Body: center + sidebar */}
      <div class="flex-1 min-h-0 flex" style="min-width: 0">
        {/* ── Center Content ──────────────────────────────────────────────── */}
        <div class="flex-1 min-w-0 w-full min-h-0 overflow-y-auto px-5 pb-6" style="flex: 1 1 0%; width: 100%">
          <Show when={data.loading && !data()}>
            <div class="flex flex-col gap-3">
              <div class="h-6 w-2/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
              <div class="h-4 w-1/3 rounded bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
              <div class="h-32 rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />
            </div>
          </Show>

          <Show when={data.error}>
            <div class="flex flex-col items-center gap-3 py-12">
              <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">
                {language.t("requirements.detail.error")}
              </p>
              <ButtonV2 size="small" variant="ghost" onClick={() => refetch()}>
                {language.t("requirements.list.retry")}
              </ButtonV2>
            </div>
          </Show>

          <Show when={!data.loading && !data.error && !data()}>
            <div class="flex flex-col items-center gap-3 py-12">
              <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">{language.t("requirements.detail.notFound")}</p>
            </div>
          </Show>

          <Show when={!data.error && data()}>
            {(req) => (
              <div class="mx-auto flex w-full max-w-[800px] flex-col gap-5">
                {/* Title + status + metadata */}
                <div>
                  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                    <h2 class="text-[18px] font-[530] text-[var(--v2-text-text-base)]">{req().title}</h2>
                    <StatusBadge status={req().status} />
                    <div class="flex-1" />
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      icon="sidebar-right"
                      onClick={() => setSidebarVisible((v) => !v)}
                    >
                      {sidebarVisible()
                        ? language.t("requirements.sidebar.hide")
                        : language.t("requirements.sidebar.show")
                      }
                    </ButtonV2>
                  </div>
                  <div class="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[12px] text-[var(--v2-text-text-muted)]">
                    <span class="font-[530]">{req().id}</span>
                    <PriorityBadge priority={req().priority} />
                    <span>
                      {language.t("requirements.detail.assignee")}：
                      <span class="text-[var(--v2-text-text-base)]">{req().assignee || "—"}</span>
                    </span>
                    <span>
                      {language.t("requirements.detail.implementer")}：
                      <span class="text-[var(--v2-text-text-base)]">{req().implementer || "—"}</span>
                    </span>
                    <span>
                      {language.t("requirements.sidebar.updatedAt")}：
                      <span class="text-[var(--v2-text-text-faint)]">{safeDate(req().updatedAt)}</span>
                    </span>
                  </div>
                </div>

                {/* Core Actions */}
                <Show when={!hasProject()}>
                  <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    {language.t("requirements.detail.projectUnavailable")}
                  </div>
                </Show>
                <div class="flex items-center gap-2 flex-wrap">
                  <ButtonV2
                    size="normal"
                    icon="grid-plus"
                    disabled={creating() || !hasProject()}
                    onClick={handleCreateSession}
                  >
                    {creating()
                      ? language.t("requirements.action.creating")
                      : hasLinks()
                        ? language.t("requirements.action.createAnotherSession")
                        : language.t("requirements.action.createRequirementSession")
                    }
                  </ButtonV2>
                  <ButtonV2
                    size="normal"
                    variant="ghost"
                    icon="plus"
                    disabled={!hasProject()}
                    onClick={handleAddToExisting}
                  >
                    {language.t("requirements.action.addToExistingSession")}
                  </ButtonV2>
                </div>

                {/* Description card */}
                <div class="w-full rounded-[8px] bg-[var(--v2-background-bg-layer-01)] border border-[var(--v2-border-border-base)] p-4">
                  <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] mb-1.5">{language.t("requirements.detail.description")}</h3>
                  <p class="text-[13px] text-[var(--v2-text-text-muted)] leading-relaxed">{req().description}</p>
                </div>

                  {/* Create Another confirm dialog */}
                  <Show when={showCreateConfirm()}>
                    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                      <div class="bg-[var(--v2-background-bg-base)] rounded-[10px] border border-[var(--v2-border-border-base)] shadow-[var(--v2-elevation-overlay)] w-full max-w-[380px] p-4 flex flex-col gap-3">
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

                  {/* AI Prompt — hidden
                  <PromptPanel
                    prompt={generatedPrompt()}
                    onGenerate={doGeneratePrompt}
                    onCopy={async () => {
                      try { await navigator.clipboard.writeText(generatedPrompt()!); showToast({ title: language.t("requirements.prompt.copied"), variant: "success" }) }
                      catch { showToast({ title: language.t("requirements.prompt.copyFailed"), variant: "error" }) }
                    }}
                    onRegenerate={doGeneratePrompt}
                  />
                  */}
                </div>
              )}
            </Show>
        </div>

        {/* ── Right Sidebar (info only) ───────────────────────────────────── */}
        <Show when={!data.error && data()}>
          {(req) => (
            <div
              class="w-72 shrink-0 overflow-y-auto border-l border-[var(--v2-border-border-base)] px-4 py-3"
              classList={{ hidden: !sidebarVisible() }}
            >
              <div class="flex flex-col gap-3">

                {/* Implementation Status + Linked Sessions */}
                <Show
                  when={hasLinks()}
                  fallback={
                    <div class="rounded-[6px] bg-[var(--v2-background-bg-layer-01)] border border-[var(--v2-border-border-base)] p-3">
                      <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)] mb-2">
                        {language.t("requirements.detail.linkedSessions")}
                      </h4>
                      <p class="text-[12px] text-[var(--v2-text-text-faint)] leading-relaxed">
                        {language.t("requirements.sidebar.noLinksHint")}
                      </p>
                    </div>
                  }
                >
                  <div class="rounded-[6px] bg-[var(--v2-background-bg-layer-01)] border border-[var(--v2-border-border-base)] p-3">
                    <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)] mb-2 flex items-center gap-1">
                      {language.t("requirements.sidebar.implementationStatus")}
                      <span
                        class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] text-[var(--v2-text-text-faint)] border border-[var(--v2-text-text-faint)]/30 cursor-help leading-none"
                        title={language.t("requirements.sidebar.statusExplain")}
                      >
                        ?
                      </span>
                    </h4>
                    <span class={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] ${STATUS_COLORS_MAP[aggregateStatus() as ExecutionStatus]}`}>
                      {language.t(`requirements.execution.status.${aggregateStatus()}`)}
                    </span>
                  </div>
                  <div class="rounded-[6px] bg-[var(--v2-background-bg-layer-01)] border border-[var(--v2-border-border-base)] p-3">
                    <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)] mb-2">
                      {language.t("requirements.detail.linkedSessions")} · {reqLinks().length}
                    </h4>
                    <div class="flex flex-col gap-1.5">
                      <For each={reqLinks()}>
                        {(link) => (
                          <button
                            type="button"
                            onClick={() => handleOpenSession(link)}
                            class="w-full text-left rounded-[6px] bg-[var(--v2-background-bg-deep)] border border-[var(--v2-border-border-base)] px-3 py-2 hover:bg-[var(--v2-background-bg-layer-02)] transition-colors"
                          >
                            <div class="text-[12px] font-[530] text-[var(--v2-text-text-base)] truncate">
                              {link.sessionTitle || `Session ${link.sessionId.slice(0, 8)}`}
                            </div>
                            <div class="flex items-center gap-2 mt-1">
                              <span class={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] ${STATUS_COLORS_MAP[link.status as unknown as ExecutionStatus]}`}>
                                {language.t(`requirements.execution.status.${link.status}`)}
                              </span>
                            </div>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* Metadata card (需求信息 + 更新时间) */}
                <div class="rounded-[6px] bg-[var(--v2-background-bg-layer-01)] border border-[var(--v2-border-border-base)] p-3">
                  <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)] mb-2">
                    {language.t("requirements.sidebar.metadata")}
                  </h4>
                  <div class="flex flex-col gap-1.5 text-[12px]">
                    <div class="flex justify-between">
                      <span class="text-[var(--v2-text-text-faint)]">ID</span>
                      <span class="text-[var(--v2-text-text-base)] font-[530]">{req().id || "—"}</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span class="text-[var(--v2-text-text-faint)]">优先级</span>
                      <PriorityBadge priority={req().priority} />
                    </div>
                    <div class="flex justify-between items-center">
                      <span class="text-[var(--v2-text-text-faint)]">{language.t("requirements.detail.assignee")}</span>
                      <span class="text-[var(--v2-text-text-base)]">{req().assignee || "—"}</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span class="text-[var(--v2-text-text-faint)]">{language.t("requirements.detail.implementer")}</span>
                      <span class="text-[var(--v2-text-text-base)]">{req().implementer || "—"}</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span class="text-[var(--v2-text-text-faint)]">{language.t("requirements.sidebar.updatedAt")}</span>
                      <span class="text-[var(--v2-text-text-base)]">{safeDate(req().updatedAt)}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
