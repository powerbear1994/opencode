import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { useRequirements, buildRawContent } from "./provider"
import { useRequirementLinks, storePendingRequirementLink } from "./services/requirementLinkStore"
import { SessionPicker } from "./session-picker"
import { resolveRequirementProject } from "./project-context"
import {
  loadRequirementDocument,
  requirementDocumentPath,
  saveRequirementDocument,
} from "./services/requirementDocument"
import { useRequirementWorkflow } from "./services/requirementWorkflowStore"
import { StageStatusTimeline, type StageStatusItem } from "./stage-status-timeline"
import type { Session } from "@opencode-ai/sdk/v2/client"

const REQUIREMENT_AGENT = "requirement-agent"
const STAGE_LABELS = ["需求阶段", "设计阶段", "开发阶段", "测试阶段"] as const

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Safe date formatter — returns "—" for invalid/missing dates */
function safeDate(iso: string | undefined | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString()
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    (error.cause as { status?: unknown }).status === 404
  )
}

// ── Component ───────────────────────────────────────────────────────────────

export const RequirementDetail: Component<{
  id: string
  project?: string
}> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const navigate = useNavigate()
  const linkStore = useRequirementLinks()
  const workflow = useRequirementWorkflow()

  const projectDir = createMemo(
    () =>
      resolveRequirementProject(
        props.project,
        server.projects.list().map((project) => project.worktree),
        server.projects.last(),
      ) ?? "",
  )
  const hasProject = createMemo(() => projectDir().length > 0)
  const [data, { refetch }] = createResource(
    () => ({ id: props.id, project: projectDir() }),
    (source) => backend.getRequirementDetail(source.project, source.id),
  )
  const [showPicker, setShowPicker] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [savingDocument, setSavingDocument] = createSignal(false)
  const [documentDraft, setDocumentDraft] = createSignal("")
  const [documentMode, setDocumentMode] = createSignal<"raw" | "clarified">("clarified")
  const [clarifiedView, setClarifiedView] = createSignal<"edit" | "preview">("preview")
  const [showCreateConfirm, setShowCreateConfirm] = createSignal(false)
  const [sidebarVisible, setSidebarVisible] = createSignal(true)
  const [syncingDocument, setSyncingDocument] = createSignal(false)
  const [document, { mutate: mutateDocument, refetch: refetchDocument }] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadRequirementDocument(source),
  )
  const documentDirty = createMemo(() => documentDraft() !== (document()?.content ?? ""))
  const locked = createMemo(() => workflow.isLocked(projectDir(), props.id))
  const workflowRecord = createMemo(() => workflow.getRecord(projectDir(), props.id))
  const designGenerated = createMemo(() => !!workflowRecord()?.designGeneratedAt)
  const developmentGenerated = createMemo(() => !!workflowRecord()?.developmentGeneratedAt)
  const testGenerated = createMemo(() => !!workflowRecord()?.testGeneratedAt)
  const designLocked = createMemo(() => workflow.isDesignLocked(projectDir(), props.id))
  const developmentLocked = createMemo(() => workflow.isDevelopmentLocked(projectDir(), props.id))
  const testLocked = createMemo(() => workflow.isTestLocked(projectDir(), props.id))
  const stageStatusItems = createMemo<StageStatusItem[]>(() =>
    STAGE_LABELS.map((stage, index) => {
      const active =
        (index === 0 && !locked()) ||
        (index === 1 && locked() && !designLocked()) ||
        (index === 2 && designLocked() && !developmentLocked()) ||
        (index === 3 && developmentLocked() && !testLocked())
      const complete =
        (index === 0 && locked()) ||
        (index === 1 && designLocked()) ||
        (index === 2 && developmentLocked()) ||
        (index === 3 && testLocked())
      const value = () => {
        if (index === 0) return locked() ? "已完成" : document() ? "待确认" : "待生成"
        if (index === 1) {
          if (!locked()) return "未开始"
          if (designLocked()) return "已完成"
          if (designGenerated()) return "待确认"
          return "待生成"
        }
        if (index === 2) {
          if (!designLocked()) return "未开始"
          if (developmentLocked()) return "已完成"
          if (developmentGenerated()) return "待确认"
          return "待生成"
        }
        if (!developmentLocked()) return "未开始"
        if (testLocked()) return "已完成"
        if (testGenerated()) return "待确认"
        return "待生成"
      }
      return { label: stage, value: value(), active, complete }
    }),
  )

  const sessionStore = createMemo(() => (projectDir() ? serverSync().child(projectDir(), { bootstrap: true })[0] : undefined))
  const sessionById = createMemo(() => new Map((sessionStore()?.session ?? []).map((session) => [session.id, session] as const)))
  const sessionAgent = (sessionId: string) => sessionById().get(sessionId)?.agent
  const sessionTitle = (sessionId: string, fallback: string) => sessionById().get(sessionId)?.title || fallback
  const reqLinks = createMemo(() =>
    linkStore.getLinksByRequirement(projectDir(), props.id).filter((l) => l.sourceMode === "raw" && !!l.sessionId && sessionAgent(l.sessionId) !== "design-agent"),
  )
  const hasLinks = createMemo(() => reqLinks().length > 0)

  function applyDocumentRefresh(current: { content: string } | null | undefined, dirtyBeforeRefresh: boolean) {
    if (dirtyBeforeRefresh) return
    setDocumentDraft(current?.content ?? "")
    if (!current) setClarifiedView("preview")
  }

  createEffect(() => {
    if (props.id && hasLinks()) setSidebarVisible(true)
  })

  createEffect(() => {
    const loaded = document()
    if (!loaded) return
    setDocumentDraft(loaded.content)
  })

  createEffect(() => {
    if (!locked()) return
    setClarifiedView("preview")
  })

  createEffect(() => {
    const project = projectDir()
    if (!project) return
    const path = requirementDocumentPath(props.id)
    const unsubscribe = serverSDK().event.on(project, (event) => {
      if (event.type !== "file.watcher.updated") return
      if (event.properties.file !== path) return
      const dirtyBeforeRefresh = documentDirty()
      void Promise.resolve(refetchDocument()).then((current) => {
        applyDocumentRefresh(current, dirtyBeforeRefresh)
      })
    })
    onCleanup(unsubscribe)
  })

  createEffect(() => {
    const links = reqLinks()
    if (links.length === 0) return

    const directories = new Set(links.map((link) => link.sessionDirectory || link.projectPath || projectDir()))
    const unsubscribe = [...directories]
      .filter(Boolean)
      .map((directory) =>
        serverSDK().event.on(directory, (event) => {
          if (event.type !== "session.deleted") return
          const sessionId = event.properties.info.id
          for (const link of links) {
            if (link.sessionId !== sessionId) continue
            linkStore.unlinkRequirementFromSession(link.projectId, link.requirementId, link.sessionId)
          }
        }),
      )

    onCleanup(() => unsubscribe.forEach((off) => off()))
  })

  createEffect(() => {
    for (const link of reqLinks()) {
      const directory = link.sessionDirectory || link.projectPath || projectDir()
      if (!directory || !link.sessionId) continue
      void serverSDK()
        .createClient({ directory, throwOnError: true })
        .session.get({ sessionID: link.sessionId })
        .catch((error) => {
          if (!isNotFound(error)) return
          linkStore.unlinkRequirementFromSession(link.projectId, link.requirementId, link.sessionId)
        })
    }
  })

  // ── Content builders ─────────────────────────────────────────────────────

  function getRawContent(): string {
    return buildRawContent(data()!)
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
      const content = getRawContent()

      // Store a pending link so the session creation flow can bind it
      storePendingRequirementLink({
        projectId: projectDir(),
        projectPath: projectDir(),
        requirementId: req.id,
        requirementTitle: req.title,
        sourceMode: "raw",
        content,
      })

      navigate(
        `/${base64Encode(projectDir())}/session?prompt=${encodeURIComponent(content)}&agent=${REQUIREMENT_AGENT}`,
      )
    } finally {
      setCreating(false)
    }
  }

  function handleCreateSession() {
    if (locked()) return
    if (reqLinks().length > 0) {
      setShowCreateConfirm(true)
      return
    }
    doCreateSession()
  }

  // ── Add to Existing Session ─────────────────────────────────────────────

  function handleAddToExisting() {
    if (locked()) return
    setShowPicker(true)
  }

  function handlePickerSelect(session: Session) {
    setShowPicker(false)
    const req = data()!
    if (!req) return
    if (!hasProject()) return

    const content = getRawContent()
    const alreadyLinked = reqLinks().some((link) => link.sessionId === session.id)
    if (alreadyLinked) {
      showToast({ title: "该会话已绑定", variant: "default" })
      return
    }

    linkStore.createLink({
      projectId: projectDir(),
      projectPath: projectDir(),
      requirementId: req.id,
      requirementTitle: req.title,
      sessionId: session.id,
      sessionTitle: session.title,
      sessionDirectory: session.directory,
      sourceMode: "raw",
      status: "filled_to_session",
      content,
    })

    navigate(
      `/${base64Encode(session.directory)}/session/${session.id}?prompt=${encodeURIComponent(content)}&agent=${REQUIREMENT_AGENT}`,
    )
  }

  function handlePickerCreateNew() {
    setShowPicker(false)
    handleCreateSession()
  }

  async function handleSaveDocument() {
    const loaded = document()
    if (!loaded || savingDocument()) return false
    setSavingDocument(true)
    try {
      await saveRequirementDocument({
        server: server.current,
        project: projectDir(),
        path: loaded.path,
        content: documentDraft(),
      })
      mutateDocument({ ...loaded, content: documentDraft() })
      setClarifiedView("preview")
      showToast({ title: "需求已保存", variant: "success" })
      return true
    } catch {
      showToast({ title: "保存需求失败", variant: "error" })
      return false
    } finally {
      setSavingDocument(false)
    }
  }

  async function handleSyncFromSession() {
    if (syncingDocument()) return
    setSyncingDocument(true)
    try {
      const previous = document()
      const dirtyBeforeRefresh = documentDirty()
      const current = await refetchDocument()
      if (current && current.content !== (previous?.content ?? "")) {
        setDocumentDraft(current.content)
        showToast({ title: "产物已从会话同步", variant: "success" })
      } else if (current && !previous) {
        setDocumentDraft(current.content)
        showToast({ title: "产物已从会话同步", variant: "success" })
      } else if (!current) {
        if (!dirtyBeforeRefresh) setDocumentDraft("")
        showToast({ title: "暂未发现可同步的新产物", variant: "default" })
      } else {
        showToast({ title: "产物已是最新", variant: "default" })
      }
    } catch {
      showToast({ title: "同步产物失败", variant: "error" })
    } finally {
      setSyncingDocument(false)
    }
  }

  async function handleLockRequirement() {
    if (locked()) return
    if (documentDirty() && !(await handleSaveDocument())) return
    const confirmed = window.confirm("锁定后当前需求产物将不可继续编辑，并会生成设计任务，是否确认？")
    if (!confirmed) return
    workflow.lockRequirement(projectDir(), props.id)
    setDocumentMode("clarified")
    setClarifiedView("preview")
    showToast({ title: "需求已完成", variant: "success" })
  }

  function handleEnterDesign() {
    navigate(`/design?project=${encodeURIComponent(projectDir())}&selectedId=${encodeURIComponent(props.id)}`)
  }

  // ── Linked Session Actions ───────────────────────────────────────────────

  function handleOpenSession(link: { sessionId: string; sessionDirectory?: string; projectPath?: string }) {
    const dir = link.sessionDirectory || link.projectPath || projectDir()
    if (!dir || !link.sessionId) return
    navigate(`/${base64Encode(dir)}/session/${link.sessionId}`)
  }

  function handleUnlinkSession(linkId: string) {
    if (locked()) return
    linkStore.removeLink(linkId)
    showToast({ title: "已解除会话关联", variant: "success" })
  }

  return (
    <div class="relative flex flex-col h-full min-h-0">
      <Show when={!data.error && data() && sidebarVisible()}>
        <div class="pointer-events-none absolute bottom-0 right-72 top-0 z-10 border-l border-[var(--v2-border-border-base)]" />
      </Show>

      {/* Session Picker Dialog */}
      <Show when={showPicker()}>
          <SessionPicker
            projectId={projectDir()}
            requirementId={props.id}
            requirementTitle={data()?.title ?? ""}
            currentReqId={props.id}
            agent={REQUIREMENT_AGENT}
            onSelect={handlePickerSelect}
            onCancel={() => setShowPicker(false)}
            onCreateNew={handlePickerCreateNew}
        />
      </Show>

      {/* Body: center + sidebar */}
      <div class="flex-1 min-h-0 flex" style="min-width: 0">
        {/* ── Center Content ──────────────────────────────────────────────── */}
        <div class="flex flex-col flex-1 min-w-0 w-full min-h-0 overflow-y-auto px-5 pb-6 pt-3" style="flex: 1 1 0%; width: 100%">
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
              <div class="mx-auto flex w-full max-w-[900px] flex-col gap-4 flex-1">
                {/* Title */}
                <div class="flex flex-col gap-3">
                  <div class="flex items-start gap-3">
                    <div class="min-w-0 flex-1">
                      <h2 class="truncate text-[18px] font-[530] text-[var(--v2-text-text-base)]">
                        {req().id} {req().title}
                      </h2>
                      <p class="mt-1 text-[12px] text-[var(--v2-text-text-muted)]">
                        负责人：{req().assignee || "—"} · 创建时间：{safeDate(req().updatedAt)}
                      </p>
                    </div>
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
                </div>

                <Show when={!hasProject()}>
                  <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    {language.t("requirements.detail.projectUnavailable")}
                  </div>
                </Show>

                {/* Requirement document */}
                <section class="flex flex-1 min-h-[520px] w-full min-w-0 flex-col rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]">
                  <div class="shrink-0 border-b border-[var(--v2-border-border-base)]">
                    <div class="flex items-center justify-between gap-3 px-4 pb-3 pt-3">
                      <div class="flex items-center gap-3 min-w-0">
                        <div class="flex rounded-[6px] border border-[var(--v2-border-border-base)] bg-transparent p-0.5">
                          <button
                            type="button"
                            onClick={() => setDocumentMode("raw")}
                            class="h-7 rounded-[5px] px-3 text-[12px] font-[530] transition-colors"
                            classList={{
                              "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)] shadow-sm": documentMode() === "raw",
                              "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)]": documentMode() !== "raw",
                            }}
                          >
                            原始输入
                          </button>
                          <button
                            type="button"
                            onClick={() => setDocumentMode("clarified")}
                            class="h-7 rounded-[5px] px-3 text-[12px] font-[530] transition-colors"
                            classList={{
                              "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)] shadow-sm": documentMode() === "clarified",
                              "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)]": documentMode() !== "clarified",
                            }}
                          >
                            需求产物
                          </button>
                        </div>
                        <Show when={documentMode() === "clarified" ? document()?.path : undefined}>
                          {(path) => (
                            <p class="truncate text-[11px] text-[var(--v2-text-text-faint)]" title={path()}>
                              {path()}
                            </p>
                          )}
                        </Show>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <Show when={documentMode() === "clarified" && document()}>
                          <Show when={!locked()}>
                            <div class="flex rounded-[6px] border border-[var(--v2-border-border-base)] bg-transparent p-0.5">
                              <button
                                type="button"
                                onClick={() => setClarifiedView("preview")}
                                class="h-7 rounded-[5px] px-3 text-[12px] font-[530] transition-colors"
                                classList={{
                                  "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)] shadow-sm": clarifiedView() === "preview",
                                  "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)]": clarifiedView() !== "preview",
                                }}
                              >
                                预览
                              </button>
                              <button
                                type="button"
                                onClick={() => setClarifiedView("edit")}
                                class="h-7 rounded-[5px] px-3 text-[12px] font-[530] transition-colors"
                                classList={{
                                  "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)] shadow-sm": clarifiedView() === "edit",
                                  "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)]": clarifiedView() !== "edit",
                                }}
                              >
                                编辑
                              </button>
                            </div>
                          </Show>
                          <Show when={!locked() && clarifiedView() === "edit"}>
                            <button
                              type="button"
                              disabled={!document() || savingDocument() || !documentDirty()}
                              onClick={handleSaveDocument}
                              class="h-7 rounded-[5px] bg-[var(--v2-background-bg-button-neutral)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] shadow-[var(--v2-elevation-button-neutral)] transition-colors hover:bg-[var(--v2-overlay-simple-overlay-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingDocument() ? "保存中" : "保存"}
                            </button>
                          </Show>
                          <Show when={locked()}>
                            <button
                              type="button"
                              onClick={handleEnterDesign}
                              class="h-7 rounded-[5px] bg-[var(--v2-background-bg-button-neutral)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] shadow-[var(--v2-elevation-button-neutral)] transition-colors hover:bg-[var(--v2-overlay-simple-overlay-hover)]"
                            >
                              进入设计
                            </button>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </div>

                  <Show
                    when={documentMode() === "raw"}
                    fallback={
                      <Show when={document.loading} fallback={
                        <Show when={document.error} fallback={
                          <Show when={document()} fallback={
                            <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                              <div class="flex flex-col gap-1">
                                <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">还没有需求产物</p>
                                <p class="max-w-[420px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                  当前只有原始输入。调用 @需求智能体后，它会基于原始需求完成澄清、拆解和整理，并在这里生成可编辑的需求产物。
                                </p>
                              </div>
                              <ButtonV2 size="small" onClick={handleCreateSession}>
                                调用智能体生成
                              </ButtonV2>
                            </div>
                          }>
                            <div class="flex min-h-0 flex-1 flex-col">
                              <Show
                                when={!locked() && clarifiedView() === "edit"}
                                fallback={
                                  <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                                    <div class="mx-auto w-full max-w-[900px]">
                                      <Markdown
                                        text={documentDraft() || " "}
                                        cacheKey={`requirement-document-preview:${req().id}:${documentDraft()}`}
                                        class="text-[13px] text-[var(--v2-text-text-muted)] leading-relaxed"
                                      />
                                    </div>
                                  </div>
                                }
                              >
                                <textarea
                                  value={documentDraft()}
                                  onInput={(event) => setDocumentDraft(event.currentTarget.value)}
                                  class="h-full min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
                                  spellcheck={false}
                                />
                              </Show>
                            </div>
                          </Show>
                        }>
                          <div class="flex flex-1 items-center justify-center p-4 text-[13px] text-[var(--v2-text-text-muted)]">
                            加载需求文件失败
                          </div>
                        </Show>
                      }>
                        <div class="flex flex-1 items-center justify-center p-4 text-[13px] text-[var(--v2-text-text-muted)]">
                          正在加载需求文件...
                        </div>
                      </Show>
                    }
                  >
                    <div class="min-h-0 flex-1 overflow-y-auto p-4">
                      <div class="mx-auto w-full max-w-[900px]">
                        <Markdown
                          text={req().description}
                          cacheKey={`requirement-description:${req().id}:${req().updatedAt}`}
                          class="text-[13px] text-[var(--v2-text-text-muted)] leading-relaxed"
                        />
                      </div>
                    </div>
                  </Show>
                </section>

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

                </div>
              )}
            </Show>
        </div>

        {/* ── Right Sidebar (info only) ───────────────────────────────────── */}
        <Show when={!data.error && data()}>
          {(req) => (
            <div
              class="w-72 shrink-0 overflow-y-auto px-4 pb-3 pt-3"
              classList={{ hidden: !sidebarVisible() }}
            >
              <div class="flex flex-col gap-3">
                {/* Stage status */}
                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
                  <h4 class="mb-2 text-[11px] font-[530] text-[var(--v2-text-text-faint)]">阶段状态</h4>
                  <StageStatusTimeline items={stageStatusItems()} />
                  <p class="mt-3 border-t border-[var(--v2-border-border-base)] pt-2 text-[11px] leading-relaxed text-[var(--v2-text-text-faint)]">
                    锁定需求产物后，将进入设计阶段。
                  </p>
                </div>

                {/* Linked sessions */}
                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3 shadow-[inset_0_1px_0_var(--v2-alpha-light-10)]">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-icon-icon-muted)]">
                        <Icon name="status-active" size="small" />
                      </span>
                      <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)]">关联会话</h4>
                    </div>
                    <Show when={!locked()}>
                      <ButtonV2 size="small" variant="ghost-muted" icon="plus" onClick={handleAddToExisting}>
                        绑定已有会话
                      </ButtonV2>
                    </Show>
                  </div>
                  <Show
                    when={hasLinks()}
                    fallback={
                      <Show
                        when={!locked()}
                        fallback={
                          <div class="rounded-[6px] border border-dashed border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3 py-2.5 text-[12px] text-[var(--v2-text-text-faint)]">
                            暂无关联会话
                          </div>
                        }
                      >
                        <button
                          type="button"
                          onClick={handleAddToExisting}
                          class="flex w-full items-center justify-between gap-3 rounded-[6px] border border-dashed border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3 py-2.5 text-left transition-colors hover:border-[var(--v2-blue-400)]/60 hover:bg-[var(--v2-background-bg-layer-02)]"
                        >
                          <span class="min-w-0">
                            <span class="block text-[12px] font-[530] text-[var(--v2-text-text-muted)]">暂无关联会话</span>
                            <span class="mt-0.5 block text-[11px] text-[var(--v2-text-text-faint)]">绑定后可从需求页快速回到智能体会话。</span>
                          </span>
                          <Icon name="plus" size="small" class="shrink-0 text-[var(--v2-blue-400)]" />
                        </button>
                      </Show>
                    }
                  >
                    <div class="flex flex-col gap-1.5">
                      <For each={reqLinks()}>
                        {(link) => (
                          <div
                            class="group relative overflow-hidden rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] transition-colors hover:border-[var(--v2-blue-400)]/50 hover:bg-[var(--v2-background-bg-layer-02)]"
                            onDblClick={() => handleOpenSession(link)}
                          >
                            <div class="absolute bottom-0 left-0 top-0 w-0.5 bg-[var(--v2-blue-400)]" />
                            <div class="flex items-center justify-between gap-2 px-2.5 py-2">
                              <div class="min-w-0">
                                <p class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]" title={link.sessionId}>
                                  {link.sessionTitle || sessionTitle(link.sessionId, "需求智能体会话")}
                                </p>
                                <div class="mt-1 flex items-center gap-1.5">
                                  <span class="h-1.5 w-1.5 rounded-full bg-[var(--v2-blue-400)]" />
                                  <span class="text-[11px] leading-none text-[var(--v2-blue-400)]">已绑定</span>
                                </div>
                              </div>
                              <Show when={!locked()}>
                                <ButtonV2 size="small" variant="ghost-muted" class="shrink-0" onDblClick={(event: MouseEvent) => event.stopPropagation()} onClick={() => handleUnlinkSession(link.id)}>
                                  解绑
                                </ButtonV2>
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                {/* Quick actions */}
                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
                  <h4 class="mb-2 text-[11px] font-[530] text-[var(--v2-text-text-faint)]">快捷操作</h4>
                  <div class="flex flex-col gap-2">
                    <Show
                      when={locked()}
                      fallback={
                        <>
                          <ButtonV2 size="normal" variant="neutral" class="w-full" onClick={handleCreateSession}>
                            调用 @需求智能体
                          </ButtonV2>
                          <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={syncingDocument()} onClick={handleSyncFromSession}>
                            {syncingDocument() ? "刷新中..." : "刷新产物"}
                          </ButtonV2>
                          <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!documentDirty()} onClick={handleSaveDocument}>
                            保存当前产物
                          </ButtonV2>
                          <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!document() || savingDocument()} onClick={handleLockRequirement}>
                            锁定需求
                          </ButtonV2>
                        </>
                      }
                    >
                      <ButtonV2 size="normal" variant="neutral" class="w-full" onClick={handleEnterDesign}>
                        进入设计
                      </ButtonV2>
                    </Show>
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
