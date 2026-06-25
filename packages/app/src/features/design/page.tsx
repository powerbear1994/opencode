import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { RequirementList } from "@/features/requirements/list"
import { buildDesignContent, RequirementsProvider, useRequirements } from "@/features/requirements/provider"
import { resolveRequirementProject } from "@/features/requirements/project-context"
import {
  designDocumentPath,
  loadDesignDocument,
  loadRequirementDocument,
  saveRequirementDocument,
} from "@/features/requirements/services/requirementDocument"
import { storePendingRequirementLink, useRequirementLinks } from "@/features/requirements/services/requirementLinkStore"
import { useRequirementWorkflow } from "@/features/requirements/services/requirementWorkflowStore"
import { StageStatusTimeline, type StageStatusItem } from "@/features/requirements/stage-status-timeline"
import { SessionPicker } from "@/features/requirements/session-picker"
import type { Session } from "@opencode-ai/sdk/v2/client"

const DESIGN_AGENT = "design-agent"
const STAGE_LABELS = ["需求阶段", "设计阶段", "开发阶段", "测试阶段"] as const

function safeDate(iso: string | undefined | null) {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString()
}

const DesignContent: Component = () => {
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
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">设计中心</h1>
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
            stage="design"
            lockedOnly
            onSelect={handleSelect}
            onDefaultSelect={handleDefaultSelect}
            selectedId={selectedId()}
          />
        </div>

        <Show when={selectedId()}>
          <div class="flex-1 min-h-0 min-w-0" style="flex: 1 1 0%; min-width: 0">
            <DesignDetail id={selectedId()!} project={projectDir()} />
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
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">选择一条已锁定需求开始设计</p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

const DesignDetail: Component<{ id: string; project?: string }> = (props) => {
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
  const [refreshingDesign, setRefreshingDesign] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [showPicker, setShowPicker] = createSignal(false)
  const [showCreateConfirm, setShowCreateConfirm] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [sidebarVisible, setSidebarVisible] = createSignal(true)
  const [data, { refetch }] = createResource(
    () => ({ id: props.id, project: projectDir() }),
    (source) => backend.getRequirementDetail(source.project, source.id),
  )
  const [document, { mutate: mutateDocument, refetch: refetchDesignDocument }] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadDesignDocument(source),
  )
  const [requirementDocument] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadRequirementDocument(source),
  )
  const locked = createMemo(() => workflow.isLocked(projectDir(), props.id))
  const workflowRecord = createMemo(() => workflow.getRecord(projectDir(), props.id))
  const designLocked = createMemo(() => workflow.isDesignLocked(projectDir(), props.id))
  const developmentLocked = createMemo(() => workflow.isDevelopmentLocked(projectDir(), props.id))
  const testLocked = createMemo(() => workflow.isTestLocked(projectDir(), props.id))
  const path = createMemo(() => document()?.path ?? designDocumentPath(props.id))
  const requirementArtifact = createMemo(() => requirementDocument()?.content.trim() ?? "")
  const canDesign = createMemo(() => locked() && requirementArtifact().length > 0)
  const currentContent = createMemo(() => document()?.content ?? "")
  const dirty = createMemo(() => draft() !== currentContent())
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
        if (index === 0) return locked() ? "已完成" : "待确认"
        if (index === 1) return designLocked() ? "已完成" : document() ? "待确认" : "待生成"
        if (index === 2) {
          if (!designLocked()) return "未开始"
          if (developmentLocked()) return "已完成"
          if (workflowRecord()?.developmentGeneratedAt) return "待确认"
          return "待生成"
        }
        if (!developmentLocked()) return "未开始"
        if (testLocked()) return "已完成"
        if (workflowRecord()?.testGeneratedAt) return "待确认"
        return "待生成"
      }
      return { label: stage, value: value(), active, complete }
    }),
  )
  const sessionStore = createMemo(() => (projectDir() ? serverSync().child(projectDir(), { bootstrap: true })[0] : undefined))
  const sessionById = createMemo(() => new Map((sessionStore()?.session ?? []).map((session) => [session.id, session] as const)))
  const sessionAgent = (sessionId: string) => sessionById().get(sessionId)?.agent
  const sessionTitle = (sessionId: string, fallback: string) => sessionById().get(sessionId)?.title || fallback
  const designLinks = createMemo(() =>
    linkStore.getLinksByRequirement(projectDir(), props.id).filter((link) => link.sourceMode === "design" && !!link.sessionId && sessionAgent(link.sessionId) !== "requirement-agent"),
  )
  const hasDesignLinks = createMemo(() => designLinks().length > 0)

  createEffect(() => {
    if (!data() || document.loading || requirementDocument.loading) return
    setDraft(currentContent())
  })

  createEffect(() => {
    if (!document()) return
    workflow.markDesignGenerated(projectDir(), props.id)
  })

  createEffect(() => {
    if (canDesign() && document() && !designLocked()) return
    setView("preview")
  })

  createEffect(() => {
    const project = projectDir()
    if (!project) return
    const file = designDocumentPath(props.id)
    const unsubscribe = serverSDK().event.on(project, (event) => {
      if (event.type !== "file.watcher.updated") return
      if (event.properties.file !== file) return
      const dirtyBeforeRefresh = dirty()
      void Promise.resolve(refetchDesignDocument()).then((current) => {
        if (current && !dirtyBeforeRefresh) setDraft(current.content)
        if (!current && !dirtyBeforeRefresh) setDraft("")
      })
    })
    onCleanup(unsubscribe)
  })

  async function handleSave() {
    if (!data() || !document() || saving() || !projectDir() || !canDesign() || designLocked()) return false
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
      showToast({ title: "设计已保存", variant: "success" })
      return true
    } catch {
      showToast({ title: "保存设计失败", variant: "error" })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleRefreshDesignDocument() {
    if (refreshingDesign()) return
    setRefreshingDesign(true)
    try {
      const previous = document()
      const dirtyBeforeRefresh = dirty()
      const current = await refetchDesignDocument()
      if (current && !dirtyBeforeRefresh) setDraft(current.content)

      if (current && current.content !== (previous?.content ?? "")) {
        showToast({ title: "设计产物已刷新", variant: "success" })
      } else if (current && !previous) {
        showToast({ title: "设计产物已刷新", variant: "success" })
      } else if (!current) {
        if (!dirtyBeforeRefresh) setDraft("")
        showToast({ title: "暂未发现设计产物", variant: "default" })
      } else {
        showToast({ title: "设计产物已是最新", variant: "default" })
      }
    } catch {
      showToast({ title: "刷新设计产物失败", variant: "error" })
    } finally {
      setRefreshingDesign(false)
    }
  }

  function handleBackToRequirement() {
    navigate(`/requirements?project=${encodeURIComponent(projectDir())}&selectedId=${encodeURIComponent(props.id)}`)
  }

  function handleEnterDevelopment() {
    navigate(`/development?project=${encodeURIComponent(projectDir())}&selectedId=${encodeURIComponent(props.id)}`)
  }

  async function handleLockDesign() {
    if (!document() || designLocked()) return
    const confirmed = window.confirm("锁定后当前设计产物将不可继续编辑，并可进入开发阶段，是否确认？")
    if (!confirmed) return
    if (dirty() && !(await handleSave())) return
    workflow.lockDesign(projectDir(), props.id)
    setView("preview")
    showToast({ title: "设计已完成", variant: "success" })
  }

  function handleUnlockRequirement() {
    if (!locked() || designLocked()) return
    const confirmed = window.confirm("解锁需求后，当前设计产物可能与新的需求版本不一致。是否解锁并返回需求页？")
    if (!confirmed) return
    workflow.unlockRequirement(projectDir(), props.id)
    showToast({ title: "需求已解锁", variant: "success" })
    handleBackToRequirement()
  }

  function doCreateDesignSession() {
    const req = data()
    if (!req || !canDesign() || creating() || designLocked()) return
    setCreating(true)
    try {
      const content = buildDesignContent(req, requirementArtifact())
      storePendingRequirementLink({
        projectId: projectDir(),
        projectPath: projectDir(),
        requirementId: req.id,
        requirementTitle: req.title,
        sourceMode: "design",
        content,
      })
      navigate(`/${base64Encode(projectDir())}/session?prompt=${encodeURIComponent(content)}&agent=${DESIGN_AGENT}`)
    } finally {
      setCreating(false)
    }
  }

  function handleCreateDesignSession() {
    if (designLinks().length > 0) {
      setShowCreateConfirm(true)
      return
    }
    doCreateDesignSession()
  }

  function handleAddToExisting() {
    if (!canDesign() || designLocked()) return
    setShowPicker(true)
  }

  function handlePickerSelect(session: Session) {
    setShowPicker(false)
    const req = data()
    if (!req || !canDesign() || designLocked()) return
    const content = buildDesignContent(req, requirementArtifact())
    const alreadyLinked = designLinks().some((link) => link.sessionId === session.id)
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
      sourceMode: "design",
      status: "filled_to_session",
      content,
    })
    navigate(`/${base64Encode(session.directory)}/session/${session.id}?prompt=${encodeURIComponent(content)}&agent=${DESIGN_AGENT}`)
  }

  function handlePickerCreateNew() {
    setShowPicker(false)
    handleCreateDesignSession()
  }

  function handleOpenSession(link: { sessionId: string; sessionDirectory?: string; projectPath?: string }) {
    const dir = link.sessionDirectory || link.projectPath || projectDir()
    if (!dir || !link.sessionId) return
    navigate(`/${base64Encode(dir)}/session/${link.sessionId}`)
  }

  function handleUnlinkSession(linkId: string) {
    linkStore.removeLink(linkId)
    showToast({ title: "已解除设计会话关联", variant: "success" })
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
            agent={DESIGN_AGENT}
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
              该需求已关联 {designLinks().length} 个设计会话，是否继续创建新的设计会话？
            </p>
            <div class="flex items-center justify-end gap-2">
              <ButtonV2 size="small" variant="ghost" onClick={() => setShowCreateConfirm(false)}>
                {language.t("requirements.picker.cancel")}
              </ButtonV2>
              <ButtonV2 size="small" onClick={() => { setShowCreateConfirm(false); doCreateDesignSession() }}>
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
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">加载设计详情失败</p>
              <ButtonV2 size="small" variant="ghost" onClick={() => refetch()}>
                {language.t("requirements.list.retry")}
              </ButtonV2>
            </div>
          </Show>

          <Show when={!data.loading && !data.error && !data()}>
            <div class="flex flex-col items-center gap-3 py-12">
              <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">未找到该设计任务</p>
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

                <Show when={!locked()}>
                  <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    该需求尚未锁定。请先回到需求中心锁定需求，再进入设计。
                  </div>
                </Show>
                <Show when={locked() && !requirementDocument.loading && !requirementArtifact()}>
                  <div class="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    <span>未找到已生成的需求产物。设计文档需要基于上一步的需求产物生成。</span>
                    <ButtonV2 size="small" variant="ghost" onClick={handleBackToRequirement}>
                      返回需求页
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
                            disabled={!canDesign() || !document() || designLocked()}
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
                        disabled={!canDesign() || !document() || saving() || !dirty() || designLocked()}
                        onClick={handleSave}
                        class="h-7 rounded-[5px] bg-[var(--v2-background-bg-button-neutral)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] shadow-[var(--v2-elevation-button-neutral)] transition-colors hover:bg-[var(--v2-overlay-simple-overlay-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving() ? "保存中" : "保存设计"}
                      </button>
                    </div>
                  </div>

                  <Show when={document.loading || requirementDocument.loading} fallback={
                    <Show
                      when={view() === "edit"}
                      fallback={
                        <Show
                          when={document()}
                          fallback={
                            <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                              <Show
                                when={canDesign()}
                                fallback={
                                  <>
                                    <div class="flex flex-col gap-1">
                                      <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">等待需求产物</p>
                                      <p class="max-w-[430px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                        请先在需求中心生成并保存需求产物。锁定后的设计阶段会读取该产物作为设计智能体输入。
                                      </p>
                                    </div>
                                    <ButtonV2 size="small" onClick={handleBackToRequirement}>
                                      查看需求产物
                                    </ButtonV2>
                                  </>
                                }
                              >
                                <div class="flex flex-col gap-1">
                                  <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">还没有设计产物</p>
                                  <p class="max-w-[460px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                    页面会把已锁定的需求产物发送给 @设计智能体，由智能体生成并写入 02-design.md。
                                  </p>
                                </div>
                                <div class="flex items-center gap-2">
                                  <ButtonV2 size="small" onClick={handleCreateDesignSession} disabled={creating() || designLocked()}>
                                    {creating() ? "创建中" : "调用 @设计智能体生成"}
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
                                cacheKey={`design-document-preview:${req().id}:${draft()}`}
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
                        disabled={!canDesign() || !document() || designLocked()}
                        class="h-full min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)] disabled:opacity-60"
                        spellcheck={false}
                      />
                    </Show>
                  }>
                    <div class="flex flex-1 items-center justify-center p-4 text-[13px] text-[var(--v2-text-text-muted)]">
                      正在加载需求产物与设计文件...
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
                    锁定设计产物后，将进入开发阶段。
                  </p>
                </div>

                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3 shadow-[inset_0_1px_0_var(--v2-alpha-light-10)]">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)]">设计智能体会话</h4>
                    <ButtonV2 size="small" variant="ghost-muted" icon="plus" disabled={!canDesign() || designLocked()} onClick={handleAddToExisting}>
                      绑定已有会话
                    </ButtonV2>
                  </div>
                  <Show
                    when={hasDesignLinks()}
                    fallback={
                      <button
                        type="button"
                        disabled={!canDesign() || designLocked()}
                        onClick={handleAddToExisting}
                        class="flex w-full items-center justify-between gap-3 rounded-[6px] border border-dashed border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3 py-2.5 text-left transition-colors hover:border-[var(--v2-blue-400)]/60 hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span class="min-w-0">
                          <span class="block text-[12px] font-[530] text-[var(--v2-text-text-muted)]">暂无设计会话</span>
                          <span class="mt-0.5 block text-[11px] text-[var(--v2-text-text-faint)]">绑定后可从设计页快速回到设计智能体会话。</span>
                        </span>
                        <Icon name="plus" size="small" class="shrink-0 text-[var(--v2-blue-400)]" />
                      </button>
                    }
                  >
                    <div class="flex flex-col gap-1.5">
                      <For each={designLinks()}>
                        {(link) => (
                          <div
                            class="group relative overflow-hidden rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] transition-colors hover:border-[var(--v2-blue-400)]/50 hover:bg-[var(--v2-background-bg-layer-02)]"
                            onDblClick={() => handleOpenSession(link)}
                          >
                            <div class="absolute bottom-0 left-0 top-0 w-0.5 bg-[var(--v2-blue-400)]" />
                            <div class="flex items-center justify-between gap-2 px-2.5 py-2">
                              <div class="min-w-0">
                                <p class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]" title={link.sessionId}>
                                  {link.sessionTitle || sessionTitle(link.sessionId, "设计智能体会话")}
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
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canDesign() || designLocked()} onClick={handleCreateDesignSession}>
                      调用 @设计智能体
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={refreshingDesign()} onClick={handleRefreshDesignDocument}>
                      {refreshingDesign() ? "刷新中..." : "刷新产物"}
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canDesign() || !document() || !dirty() || designLocked()} onClick={handleSave}>
                      保存当前产物
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canDesign() || !document() || designLocked()} onClick={handleLockDesign}>
                      锁定设计产物
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!designLocked()} onClick={handleEnterDevelopment}>
                      进入开发
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!locked() || designLocked()} onClick={handleUnlockRequirement}>
                      解锁需求
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" onClick={handleBackToRequirement}>
                      查看需求产物
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

export default function DesignPage() {
  return (
    <RequirementsProvider>
      <DesignContent />
    </RequirementsProvider>
  )
}
