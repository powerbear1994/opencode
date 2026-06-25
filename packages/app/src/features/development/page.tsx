import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Markdown } from "@opencode-ai/ui/markdown"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { RequirementList } from "@/features/requirements/list"
import { buildDevelopmentContent, RequirementsProvider, useRequirements } from "@/features/requirements/provider"
import { resolveRequirementProject } from "@/features/requirements/project-context"
import {
  developmentDocumentPath,
  loadDevelopmentDocument,
  loadDesignDocument,
  saveRequirementDocument,
} from "@/features/requirements/services/requirementDocument"
import { storePendingRequirementLink, useRequirementLinks } from "@/features/requirements/services/requirementLinkStore"
import { useRequirementWorkflow } from "@/features/requirements/services/requirementWorkflowStore"
import { StageStatusTimeline, type StageStatusItem } from "@/features/requirements/stage-status-timeline"
import { SessionPicker } from "@/features/requirements/session-picker"
import type { Session } from "@opencode-ai/sdk/v2/client"

const DEVELOPMENT_AGENT = "development-agent"
const STAGE_LABELS = ["需求阶段", "设计阶段", "开发阶段", "测试阶段"] as const

function safeDate(iso: string | undefined | null) {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString()
}

const DevelopmentContent: Component = () => {
  const language = useLanguage()
  const server = useServer()
  const [searchParams, setSearchParams] = useSearchParams<{ selectedId?: string; project?: string }>()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const projectDir = createMemo(() =>
    resolveRequirementProject(
      searchParams.project,
      server.projects.list().map((project) => project.worktree),
    ),
  )

  createEffect(() => setSelectedId(projectDir() ? (searchParams.selectedId ?? null) : null))

  function handleSelect(id: string) {
    if (!projectDir()) return
    setSelectedId(id)
    setSearchParams({ project: projectDir(), selectedId: id })
  }

  function handleDefaultSelect(id: string) {
    if (!projectDir() || searchParams.selectedId) return
    setSelectedId(id)
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <header class="shrink-0 flex items-center justify-between gap-4 border-b border-[var(--v2-border-border-base)] px-5 pt-4 pb-3">
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">开发中心</h1>
        <Show when={projectDir()}>
          {(project) => (
            <p class="min-w-0 truncate text-[12px] text-[var(--v2-text-text-muted)]" title={project()}>
              {language.t("requirements.detail.project")}：
              <span class="text-[var(--v2-text-text-base)]">{getFilename(project())}</span>
            </p>
          )}
        </Show>
      </header>

      <div class="relative flex flex-1 min-h-0">
        <div
          classList={{
            "h-full min-h-0": true,
            "border-r border-[var(--v2-border-border-base)]": !!selectedId(),
            "w-full max-w-[340px]": !selectedId(),
            "hidden lg:block lg:w-[300px] lg:shrink-0 xl:w-[340px]": !!selectedId(),
          }}
        >
          <RequirementList
            project={projectDir()}
            stage="development"
            lockedOnly
            onSelect={handleSelect}
            onDefaultSelect={handleDefaultSelect}
            selectedId={selectedId()}
          />
        </div>

        <Show when={selectedId()}>
          <div class="flex-1 min-h-0 min-w-0" style="flex: 1 1 0%; min-width: 0">
            <DevelopmentDetail id={selectedId()!} project={projectDir()} />
          </div>
        </Show>
        <Show when={!selectedId()}>
          <div
            class="hidden items-center justify-center xl:flex"
            classList={{
              "absolute inset-0": !projectDir(),
              "flex-1": !!projectDir(),
            }}
          >
            <Show
              when={projectDir()}
              fallback={
                <div class="flex flex-col items-center gap-2 text-center">
                  <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">未选择项目</p>
                  <p class="text-[12px] text-[var(--v2-text-text-faint)]">
                    {language.t("requirements.list.noProject")}
                  </p>
                </div>
              }
            >
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">选择一条已锁定设计开始开发</p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

const DevelopmentDetail: Component<{ id: string; project?: string }> = (props) => {
  const backend = useRequirements()
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const workflow = useRequirementWorkflow()
  const navigate = useNavigate()
  const linkStore = useRequirementLinks()
  const projectDir = createMemo(
    () =>
      resolveRequirementProject(
        props.project,
        server.projects.list().map((project) => project.worktree),
      ) ?? "",
  )
  const [view, setView] = createSignal<"preview" | "edit">("preview")
  const [saving, setSaving] = createSignal(false)
  const [refreshingDevelopment, setRefreshingDevelopment] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [showPicker, setShowPicker] = createSignal(false)
  const [showCreateConfirm, setShowCreateConfirm] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [sidebarVisible, setSidebarVisible] = createSignal(true)
  const [data, { refetch }] = createResource(
    () => ({ id: props.id, project: projectDir() }),
    (source) => backend.getRequirementDetail(source.project, source.id),
  )
  const [document, { mutate: mutateDocument, refetch: refetchDevelopmentDocument }] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadDevelopmentDocument(source),
  )
  const [designDocument] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadDesignDocument(source),
  )
  const requirementLocked = createMemo(() => workflow.isLocked(projectDir(), props.id))
  const workflowRecord = createMemo(() => workflow.getRecord(projectDir(), props.id))
  const designLocked = createMemo(() => workflow.isDesignLocked(projectDir(), props.id))
  const developmentLocked = createMemo(() => workflow.isDevelopmentLocked(projectDir(), props.id))
  const testLocked = createMemo(() => workflow.isTestLocked(projectDir(), props.id))
  const path = createMemo(() => document()?.path ?? developmentDocumentPath(props.id))
  const designArtifact = createMemo(() => designDocument()?.content.trim() ?? "")
  const canDevelop = createMemo(() => designLocked() && designArtifact().length > 0)
  const currentContent = createMemo(() => document()?.content ?? "")
  const dirty = createMemo(() => draft() !== currentContent())
  const stageStatusItems = createMemo<StageStatusItem[]>(() =>
    STAGE_LABELS.map((stage, index) => {
      const active =
        (index === 0 && !requirementLocked()) ||
        (index === 1 && requirementLocked() && !designLocked()) ||
        (index === 2 && designLocked() && !developmentLocked()) ||
        (index === 3 && developmentLocked() && !testLocked())
      const complete =
        (index === 0 && requirementLocked()) ||
        (index === 1 && designLocked()) ||
        (index === 2 && developmentLocked()) ||
        (index === 3 && testLocked())
      const value = () => {
        if (index === 0) return requirementLocked() ? "已完成" : "待确认"
        if (index === 1) return designLocked() ? "已完成" : "待确认"
        if (index === 2) return developmentLocked() ? "已完成" : document() ? "待确认" : "待生成"
        if (!developmentLocked()) return "未开始"
        if (testLocked()) return "已完成"
        if (workflowRecord()?.testGeneratedAt) return "待确认"
        return "待生成"
      }
      return { label: stage, value: value(), active, complete }
    }),
  )
  const sessionStore = createMemo(() => (projectDir() ? serverSync.child(projectDir(), { bootstrap: true })[0] : undefined))
  const sessionById = createMemo(() => new Map((sessionStore()?.session ?? []).map((session) => [session.id, session] as const)))
  const sessionAgent = (sessionId: string) => sessionById().get(sessionId)?.agent
  const sessionTitle = (sessionId: string, fallback: string) => sessionById().get(sessionId)?.title || fallback
  const developmentLinks = createMemo(() =>
    linkStore.getLinksByRequirement(projectDir(), props.id).filter((link) => {
      const agent = sessionAgent(link.sessionId)
      return link.sourceMode === "development" && !!link.sessionId && agent !== "requirement-agent" && agent !== "design-agent"
    }),
  )
  const hasDevelopmentLinks = createMemo(() => developmentLinks().length > 0)

  createEffect(() => {
    if (!data() || document.loading || designDocument.loading) return
    setDraft(currentContent())
  })

  createEffect(() => {
    if (!document()) return
    workflow.markDevelopmentGenerated(projectDir(), props.id)
  })

  createEffect(() => {
    if (canDevelop() && document() && !developmentLocked()) return
    setView("preview")
  })

  createEffect(() => {
    const project = projectDir()
    if (!project) return
    const file = developmentDocumentPath(props.id)
    const unsubscribe = serverSDK.event.on(project, (event) => {
      if (event.type !== "file.watcher.updated") return
      if (event.properties.file !== file) return
      const dirtyBeforeRefresh = dirty()
      void Promise.resolve(refetchDevelopmentDocument()).then((current) => {
        if (current && !dirtyBeforeRefresh) setDraft(current.content)
        if (!current && !dirtyBeforeRefresh) setDraft("")
      })
    })
    onCleanup(unsubscribe)
  })

  async function handleSave() {
    if (!data() || !document() || saving() || !projectDir() || !canDevelop() || developmentLocked()) return false
    setSaving(true)
    try {
      await saveRequirementDocument({
        server: server.current,
        project: projectDir(),
        path: path(),
        content: draft(),
      })
      mutateDocument({ path: path(), content: draft(), created: false })
      setView("preview")
      showToast({ title: "开发已保存", variant: "success" })
      return true
    } catch {
      showToast({ title: "保存开发失败", variant: "error" })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleRefreshDevelopmentDocument() {
    if (refreshingDevelopment()) return
    setRefreshingDevelopment(true)
    try {
      const previous = document()
      const dirtyBeforeRefresh = dirty()
      const current = await refetchDevelopmentDocument()
      if (current && !dirtyBeforeRefresh) setDraft(current.content)

      if (current && current.content !== (previous?.content ?? "")) {
        showToast({ title: "开发产物已刷新", variant: "success" })
      } else if (current && !previous) {
        showToast({ title: "开发产物已刷新", variant: "success" })
      } else if (!current) {
        if (!dirtyBeforeRefresh) setDraft("")
        showToast({ title: "暂未发现开发产物", variant: "default" })
      } else {
        showToast({ title: "开发产物已是最新", variant: "default" })
      }
    } catch {
      showToast({ title: "刷新开发产物失败", variant: "error" })
    } finally {
      setRefreshingDevelopment(false)
    }
  }

  function handleBackToDesign() {
    navigate(`/design?project=${encodeURIComponent(projectDir())}&selectedId=${encodeURIComponent(props.id)}`)
  }

  function handleEnterTest() {
    navigate(`/test?project=${encodeURIComponent(projectDir())}&selectedId=${encodeURIComponent(props.id)}`)
  }

  async function handleLockDevelopment() {
    if (!document() || developmentLocked()) return
    const confirmed = window.confirm("锁定后当前开发产物将不可继续编辑，并可进入测试阶段，是否确认？")
    if (!confirmed) return
    if (dirty() && !(await handleSave())) return
    workflow.lockDevelopment(projectDir(), props.id)
    setView("preview")
    showToast({ title: "开发已完成", variant: "success" })
  }

  function handleUnlockDesign() {
    if (!designLocked() || developmentLocked()) return
    const confirmed = window.confirm("解锁设计后，当前开发产物可能与新的设计版本不一致。是否解锁并返回设计页？")
    if (!confirmed) return
    workflow.unlockDesign(projectDir(), props.id)
    showToast({ title: "设计已解锁", variant: "success" })
    handleBackToDesign()
  }

  function doCreateDevelopmentSession() {
    const req = data()
    if (!req || !canDevelop() || creating() || developmentLocked()) return
    setCreating(true)
    try {
      const content = buildDevelopmentContent(req, designArtifact())
      storePendingRequirementLink({
        projectId: projectDir(),
        projectPath: projectDir(),
        requirementId: req.id,
        requirementTitle: req.title,
        sourceMode: "development",
        content,
      })
      navigate(`/${base64Encode(projectDir())}/session?prompt=${encodeURIComponent(content)}&agent=${DEVELOPMENT_AGENT}`)
    } finally {
      setCreating(false)
    }
  }

  function handleCreateDevelopmentSession() {
    if (developmentLinks().length > 0) {
      setShowCreateConfirm(true)
      return
    }
    doCreateDevelopmentSession()
  }

  function handleAddToExisting() {
    if (!canDevelop() || developmentLocked()) return
    setShowPicker(true)
  }

  function handlePickerSelect(session: Session) {
    setShowPicker(false)
    const req = data()
    if (!req || !canDevelop() || developmentLocked()) return
    const content = buildDevelopmentContent(req, designArtifact())
    const alreadyLinked = developmentLinks().some((link) => link.sessionId === session.id)
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
      sourceMode: "development",
      status: "filled_to_session",
      content,
    })
    navigate(`/${base64Encode(session.directory)}/session/${session.id}?prompt=${encodeURIComponent(content)}&agent=${DEVELOPMENT_AGENT}`)
  }

  function handlePickerCreateNew() {
    setShowPicker(false)
    handleCreateDevelopmentSession()
  }

  function handleOpenSession(link: { sessionId: string; sessionDirectory?: string; projectPath?: string }) {
    const dir = link.sessionDirectory || link.projectPath || projectDir()
    if (!dir || !link.sessionId) return
    navigate(`/${base64Encode(dir)}/session/${link.sessionId}`)
  }

  function handleUnlinkSession(linkId: string) {
    linkStore.removeLink(linkId)
    showToast({ title: "已解除开发会话关联", variant: "success" })
  }

  return (
    <div class="relative flex h-full min-h-0 flex-col">
      <Show when={showPicker() && data()}>
        {(req) => (
          <SessionPicker
            projectId={projectDir()}
            requirementId={props.id}
            requirementTitle={req().title}
            currentReqId={props.id}
            agent={DEVELOPMENT_AGENT}
            onSelect={handlePickerSelect}
            onCancel={() => setShowPicker(false)}
            onCreateNew={handlePickerCreateNew}
          />
        )}
      </Show>
      <Show when={showCreateConfirm()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div class="flex w-full max-w-[380px] flex-col gap-3 rounded-[10px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] p-4 shadow-[var(--v2-elevation-overlay)]">
            <p class="text-[13px] text-[var(--v2-text-text-base)]">
              该需求已关联 {developmentLinks().length} 个开发会话，是否继续创建新的开发会话？
            </p>
            <div class="flex items-center justify-end gap-2">
              <ButtonV2 size="small" variant="ghost" onClick={() => setShowCreateConfirm(false)}>
                {language.t("requirements.picker.cancel")}
              </ButtonV2>
              <ButtonV2 size="small" onClick={() => { setShowCreateConfirm(false); doCreateDevelopmentSession() }}>
                {language.t("requirements.action.continueCreate")}
              </ButtonV2>
            </div>
          </div>
        </div>
      </Show>
      <Show when={!data.error && data() && sidebarVisible()}>
        <div class="pointer-events-none absolute bottom-0 right-72 top-0 z-10 border-l border-[var(--v2-border-border-base)]" />
      </Show>
      <div class="flex flex-1 min-h-0" style="min-width: 0">
        <div class="flex flex-1 min-w-0 w-full min-h-0 flex-col overflow-y-auto px-5 pb-6 pt-3" style="flex: 1 1 0%; width: 100%">
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
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">加载开发详情失败</p>
              <ButtonV2 size="small" variant="ghost" onClick={() => refetch()}>
                {language.t("requirements.list.retry")}
              </ButtonV2>
            </div>
          </Show>

          <Show when={!data.loading && !data.error && !data()}>
            <div class="flex flex-col items-center gap-3 py-12">
              <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">未找到该开发任务</p>
            </div>
          </Show>

          <Show when={!data.error && data()}>
            {(req) => (
              <div class="mx-auto flex w-full max-w-[900px] flex-1 flex-col gap-4">
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
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      icon="sidebar-right"
                      onClick={() => setSidebarVisible((value) => !value)}
                    >
                      {sidebarVisible()
                        ? language.t("requirements.sidebar.hide")
                        : language.t("requirements.sidebar.show")
                      }
                    </ButtonV2>
                  </div>
                </div>

                <Show when={!designLocked()}>
                  <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    该设计尚未锁定。请先回到设计中心锁定设计，再进入开发。
                  </div>
                </Show>
                <Show when={designLocked() && !designDocument.loading && !designArtifact()}>
                  <div class="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    <span>未找到已生成的设计产物。开发文档需要基于上一步的设计产物生成。</span>
                    <ButtonV2 size="small" variant="ghost" onClick={handleBackToDesign}>
                      返回设计页
                    </ButtonV2>
                  </div>
                </Show>

                <section class="flex min-h-[520px] w-full min-w-0 flex-1 flex-col rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]">
                  <div class="shrink-0 border-b border-[var(--v2-border-border-base)]">
                    <div class="flex items-center justify-between gap-3 px-4 pb-3 pt-3">
                      <div class="flex min-w-0 items-center gap-3">
                        <div class="flex rounded-[6px] border border-[var(--v2-border-border-base)] bg-transparent p-0.5">
                          <button
                            type="button"
                            onClick={() => setView("preview")}
                            class="h-7 rounded-[5px] px-3 text-[12px] font-[530] transition-colors"
                            classList={{
                              "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)] shadow-sm": view() === "preview",
                              "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)]": view() !== "preview",
                            }}
                          >
                            预览
                          </button>
                          <button
                            type="button"
                            onClick={() => setView("edit")}
                            disabled={!canDevelop() || !document() || developmentLocked()}
                            class="h-7 rounded-[5px] px-3 text-[12px] font-[530] transition-colors"
                            classList={{
                              "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)] shadow-sm": view() === "edit",
                              "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)]": view() !== "edit",
                            }}
                          >
                            编辑
                          </button>
                        </div>
                        <p class="truncate text-[11px] text-[var(--v2-text-text-faint)]" title={path()}>
                          {path()}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!canDevelop() || !document() || saving() || !dirty() || developmentLocked()}
                        onClick={handleSave}
                        class="h-7 rounded-[5px] bg-[var(--v2-background-bg-button-neutral)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] shadow-[var(--v2-elevation-button-neutral)] transition-colors hover:bg-[var(--v2-overlay-simple-overlay-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving() ? "保存中" : "保存开发"}
                      </button>
                    </div>
                  </div>

                  <Show when={document.loading || designDocument.loading} fallback={
                    <Show
                      when={view() === "edit"}
                      fallback={
                        <Show
                          when={document()}
                          fallback={
                            <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                              <Show
                                when={canDevelop()}
                                fallback={
                                  <>
                                    <div class="flex flex-col gap-1">
                                      <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">等待设计产物</p>
                                      <p class="max-w-[430px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                        请先在设计中心生成并保存设计产物。锁定后的开发阶段会读取该产物作为开发智能体输入。
                                      </p>
                                    </div>
                                    <ButtonV2 size="small" onClick={handleBackToDesign}>
                                      查看设计产物
                                    </ButtonV2>
                                  </>
                                }
                              >
                                <div class="flex flex-col gap-1">
                                  <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">还没有开发产物</p>
                                  <p class="max-w-[460px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                    页面会把已锁定的设计产物发送给 @开发智能体，由智能体生成并写入 03-development.md。
                                  </p>
                                </div>
                                <div class="flex items-center gap-2">
                                  <ButtonV2 size="small" onClick={handleCreateDevelopmentSession} disabled={creating() || developmentLocked()}>
                                    {creating() ? "创建中" : "调用 @开发智能体生成"}
                                  </ButtonV2>
                                </div>
                              </Show>
                            </div>
                          }
                        >
                          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            <div class="mx-auto w-full max-w-[900px]">
                              <Markdown
                                text={draft() || " "}
                                cacheKey={`development-document-preview:${req().id}:${draft()}`}
                                class="text-[13px] text-[var(--v2-text-text-muted)] leading-relaxed"
                              />
                            </div>
                          </div>
                        </Show>
                      }
                    >
                      <textarea
                        value={draft()}
                        onInput={(event) => setDraft(event.currentTarget.value)}
                        disabled={!canDevelop() || !document() || developmentLocked()}
                        class="h-full min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)] disabled:opacity-60"
                        spellcheck={false}
                      />
                    </Show>
                  }>
                    <div class="flex flex-1 items-center justify-center p-4 text-[13px] text-[var(--v2-text-text-muted)]">
                      正在加载设计产物与开发文件...
                    </div>
                  </Show>
                </section>
              </div>
            )}
          </Show>
        </div>

        <Show when={!data.error && data()}>
          {(req) => (
            <div class="w-72 shrink-0 overflow-y-auto px-4 pb-3 pt-3" classList={{ hidden: !sidebarVisible() }}>
              <div class="flex flex-col gap-3">
                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
                  <h4 class="mb-2 text-[11px] font-[530] text-[var(--v2-text-text-faint)]">阶段状态</h4>
                  <StageStatusTimeline items={stageStatusItems()} />
                  <p class="mt-3 border-t border-[var(--v2-border-border-base)] pt-2 text-[11px] leading-relaxed text-[var(--v2-text-text-faint)]">
                    锁定开发产物后，将进入测试阶段。
                  </p>
                </div>

                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3 shadow-[inset_0_1px_0_var(--v2-alpha-light-10)]">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)]">开发智能体会话</h4>
                    <ButtonV2 size="small" variant="ghost-muted" icon="plus" disabled={!canDevelop() || developmentLocked()} onClick={handleAddToExisting}>
                      绑定已有会话
                    </ButtonV2>
                  </div>
                  <Show
                    when={hasDevelopmentLinks()}
                    fallback={
                      <button
                        type="button"
                        disabled={!canDevelop() || developmentLocked()}
                        onClick={handleAddToExisting}
                        class="flex w-full items-center justify-between gap-3 rounded-[6px] border border-dashed border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3 py-2.5 text-left transition-colors hover:border-[var(--v2-blue-400)]/60 hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span class="min-w-0">
                          <span class="block text-[12px] font-[530] text-[var(--v2-text-text-muted)]">暂无开发会话</span>
                          <span class="mt-0.5 block text-[11px] text-[var(--v2-text-text-faint)]">绑定后可从开发页快速回到开发智能体会话。</span>
                        </span>
                        <Icon name="plus" size="small" class="shrink-0 text-[var(--v2-blue-400)]" />
                      </button>
                    }
                  >
                    <div class="flex flex-col gap-1.5">
                      <For each={developmentLinks()}>
                        {(link) => (
                          <div
                            class="group relative overflow-hidden rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] transition-colors hover:border-[var(--v2-blue-400)]/50 hover:bg-[var(--v2-background-bg-layer-02)]"
                            onDblClick={() => handleOpenSession(link)}
                          >
                            <div class="absolute bottom-0 left-0 top-0 w-0.5 bg-[var(--v2-blue-400)]" />
                            <div class="flex items-center justify-between gap-2 px-2.5 py-2">
                              <div class="min-w-0">
                                <p class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]" title={link.sessionId}>
                                  {link.sessionTitle || sessionTitle(link.sessionId, "开发智能体会话")}
                                </p>
                                <div class="mt-1 flex items-center gap-1.5">
                                  <span class="h-1.5 w-1.5 rounded-full bg-[var(--v2-blue-400)]" />
                                  <span class="text-[11px] leading-none text-[var(--v2-blue-400)]">已绑定</span>
                                </div>
                              </div>
                              <ButtonV2
                                size="small"
                                variant="ghost-muted"
                                class="shrink-0"
                                onDblClick={(event: MouseEvent) => event.stopPropagation()}
                                onClick={() => handleUnlinkSession(link.id)}
                              >
                                解绑
                              </ButtonV2>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
                  <h4 class="mb-2 text-[11px] font-[530] text-[var(--v2-text-text-faint)]">快捷操作</h4>
                  <div class="flex flex-col gap-2">
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canDevelop() || developmentLocked()} onClick={handleCreateDevelopmentSession}>
                      调用 @开发智能体
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={refreshingDevelopment()} onClick={handleRefreshDevelopmentDocument}>
                      {refreshingDevelopment() ? "刷新中..." : "刷新产物"}
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canDevelop() || !document() || !dirty() || developmentLocked()} onClick={handleSave}>
                      保存当前产物
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canDevelop() || !document() || developmentLocked()} onClick={handleLockDevelopment}>
                      锁定开发产物
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!developmentLocked()} onClick={handleEnterTest}>
                      进入测试
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!designLocked() || developmentLocked()} onClick={handleUnlockDesign}>
                      解锁设计
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" onClick={handleBackToDesign}>
                      查看设计产物
                    </ButtonV2>
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

export default function DevelopmentPage() {
  return (
    <RequirementsProvider>
      <DevelopmentContent />
    </RequirementsProvider>
  )
}
