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
import { buildTestContent, RequirementsProvider, useRequirements } from "@/features/requirements/provider"
import { resolveRequirementProject } from "@/features/requirements/project-context"
import {
  testDocumentPath,
  loadTestDocument,
  loadDevelopmentDocument,
  saveRequirementDocument,
} from "@/features/requirements/services/requirementDocument"
import { storePendingRequirementLink, useRequirementLinks } from "@/features/requirements/services/requirementLinkStore"
import { useRequirementWorkflow } from "@/features/requirements/services/requirementWorkflowStore"
import { StageStatusTimeline, type StageStatusItem } from "@/features/requirements/stage-status-timeline"
import { SessionPicker } from "@/features/requirements/session-picker"
import type { Session } from "@opencode-ai/sdk/v2/client"

const TEST_AGENT = "test-agent"
const STAGE_LABELS = ["需求阶段", "设计阶段", "开发阶段", "测试阶段"] as const

function safeDate(iso: string | undefined | null) {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString()
}

const TestContent: Component = () => {
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
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">测试中心</h1>
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
            stage="test"
            lockedOnly
            onSelect={handleSelect}
            onDefaultSelect={handleDefaultSelect}
            selectedId={selectedId()}
          />
        </div>

        <Show when={selectedId()}>
          <div class="flex-1 min-h-0 min-w-0" style="flex: 1 1 0%; min-width: 0">
            <TestDetail id={selectedId()!} project={projectDir()} />
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
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">选择一条已锁定开发开始测试</p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

const TestDetail: Component<{ id: string; project?: string }> = (props) => {
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
  const [refreshingTest, setRefreshingTest] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [showPicker, setShowPicker] = createSignal(false)
  const [showCreateConfirm, setShowCreateConfirm] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [sidebarVisible, setSidebarVisible] = createSignal(true)
  const [data, { refetch }] = createResource(
    () => ({ id: props.id, project: projectDir() }),
    (source) => backend.getRequirementDetail(source.project, source.id),
  )
  const [document, { mutate: mutateDocument, refetch: refetchTestDocument }] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadTestDocument(source),
  )
  const [developmentDocument] = createResource(
    () => {
      const req = data()
      const project = projectDir()
      if (!req || !project) return
      return { server: server.current, project, requirement: req }
    },
    (source) => loadDevelopmentDocument(source),
  )
  const requirementLocked = createMemo(() => workflow.isLocked(projectDir(), props.id))
  const designLocked = createMemo(() => workflow.isDesignLocked(projectDir(), props.id))
  const developmentLocked = createMemo(() => workflow.isDevelopmentLocked(projectDir(), props.id))
  const testLocked = createMemo(() => workflow.isTestLocked(projectDir(), props.id))
  const path = createMemo(() => document()?.path ?? testDocumentPath(props.id))
  const developmentArtifact = createMemo(() => developmentDocument()?.content.trim() ?? "")
  const canTest = createMemo(() => developmentLocked() && developmentArtifact().length > 0)
  const currentContent = createMemo(() => document()?.content ?? "")
  const dirty = createMemo(() => draft() !== currentContent())
  const stageStatusItems = createMemo<StageStatusItem[]>(() =>
    STAGE_LABELS.map((stage, index) => {
      const active = index === 3 && canTest() && !testLocked()
      const complete =
        (index === 0 && requirementLocked()) ||
        (index === 1 && designLocked()) ||
        (index === 2 && developmentLocked()) ||
        (index === 3 && testLocked())
      const value = () => {
        if (index === 0) return requirementLocked() ? "已完成" : "待确认"
        if (index === 1) return designLocked() ? "已完成" : "待确认"
        if (index === 2) return developmentLocked() ? "已完成" : "待确认"
        return testLocked() ? "已完成" : document() ? "待确认" : "待生成"
      }
      return { label: stage, value: value(), active, complete }
    }),
  )
  const sessionStore = createMemo(() => (projectDir() ? serverSync.child(projectDir(), { bootstrap: true })[0] : undefined))
  const sessionById = createMemo(() => new Map((sessionStore()?.session ?? []).map((session) => [session.id, session] as const)))
  const sessionAgent = (sessionId: string) => sessionById().get(sessionId)?.agent
  const sessionTitle = (sessionId: string, fallback: string) => sessionById().get(sessionId)?.title || fallback
  const testLinks = createMemo(() =>
    linkStore.getLinksByRequirement(projectDir(), props.id).filter((link) => {
      const agent = sessionAgent(link.sessionId)
      return link.sourceMode === "test" && !!link.sessionId && agent !== "requirement-agent" && agent !== "design-agent" && agent !== "development-agent"
    }),
  )
  const hasTestLinks = createMemo(() => testLinks().length > 0)

  createEffect(() => {
    if (!data() || document.loading || developmentDocument.loading) return
    setDraft(currentContent())
  })

  createEffect(() => {
    if (!document()) return
    workflow.markTestGenerated(projectDir(), props.id)
  })

  createEffect(() => {
    if (canTest() && document() && !testLocked()) return
    setView("preview")
  })

  createEffect(() => {
    const project = projectDir()
    if (!project) return
    const file = testDocumentPath(props.id)
    const unsubscribe = serverSDK.event.on(project, (event) => {
      if (event.type !== "file.watcher.updated") return
      if (event.properties.file !== file) return
      const dirtyBeforeRefresh = dirty()
      void Promise.resolve(refetchTestDocument()).then((current) => {
        if (current && !dirtyBeforeRefresh) setDraft(current.content)
        if (!current && !dirtyBeforeRefresh) setDraft("")
      })
    })
    onCleanup(unsubscribe)
  })

  async function handleSave() {
    if (!data() || !document() || saving() || !projectDir() || !canTest() || testLocked()) return false
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
      showToast({ title: "测试已保存", variant: "success" })
      return true
    } catch {
      showToast({ title: "保存测试失败", variant: "error" })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleRefreshTestDocument() {
    if (refreshingTest()) return
    setRefreshingTest(true)
    try {
      const previous = document()
      const dirtyBeforeRefresh = dirty()
      const current = await refetchTestDocument()
      if (current && !dirtyBeforeRefresh) setDraft(current.content)

      if (current && current.content !== (previous?.content ?? "")) {
        showToast({ title: "测试产物已刷新", variant: "success" })
      } else if (current && !previous) {
        showToast({ title: "测试产物已刷新", variant: "success" })
      } else if (!current) {
        if (!dirtyBeforeRefresh) setDraft("")
        showToast({ title: "暂未发现测试产物", variant: "default" })
      } else {
        showToast({ title: "测试产物已是最新", variant: "default" })
      }
    } catch {
      showToast({ title: "刷新测试产物失败", variant: "error" })
    } finally {
      setRefreshingTest(false)
    }
  }

  function handleBackToDevelopment() {
    navigate(`/development?project=${encodeURIComponent(projectDir())}&selectedId=${encodeURIComponent(props.id)}`)
  }

  async function handleLockTest() {
    if (!document() || testLocked()) return
    const confirmed = window.confirm("锁定后当前测试产物将不可继续编辑，是否确认？")
    if (!confirmed) return
    if (dirty() && !(await handleSave())) return
    workflow.lockTest(projectDir(), props.id)
    setView("preview")
    showToast({ title: "测试已完成", variant: "success" })
  }

  function handleUnlockDevelopment() {
    if (!developmentLocked() || testLocked()) return
    const confirmed = window.confirm("解锁开发后，当前测试产物可能与新的开发版本不一致。是否解锁并返回开发页？")
    if (!confirmed) return
    workflow.unlockDevelopment(projectDir(), props.id)
    showToast({ title: "开发已解锁", variant: "success" })
    handleBackToDevelopment()
  }

  function doCreateTestSession() {
    const req = data()
    if (!req || !canTest() || creating() || testLocked()) return
    setCreating(true)
    try {
      const content = buildTestContent(req, developmentArtifact())
      storePendingRequirementLink({
        projectId: projectDir(),
        projectPath: projectDir(),
        requirementId: req.id,
        requirementTitle: req.title,
        sourceMode: "test",
        content,
      })
      navigate(`/${base64Encode(projectDir())}/session?prompt=${encodeURIComponent(content)}&agent=${TEST_AGENT}`)
    } finally {
      setCreating(false)
    }
  }

  function handleCreateTestSession() {
    if (testLinks().length > 0) {
      setShowCreateConfirm(true)
      return
    }
    doCreateTestSession()
  }

  function handleAddToExisting() {
    if (!canTest() || testLocked()) return
    setShowPicker(true)
  }

  function handlePickerSelect(session: Session) {
    setShowPicker(false)
    const req = data()
    if (!req || !canTest() || testLocked()) return
    const content = buildTestContent(req, developmentArtifact())
    const alreadyLinked = testLinks().some((link) => link.sessionId === session.id)
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
      sourceMode: "test",
      status: "filled_to_session",
      content,
    })
    navigate(`/${base64Encode(session.directory)}/session/${session.id}?prompt=${encodeURIComponent(content)}&agent=${TEST_AGENT}`)
  }

  function handlePickerCreateNew() {
    setShowPicker(false)
    handleCreateTestSession()
  }

  function handleOpenSession(link: { sessionId: string; sessionDirectory?: string; projectPath?: string }) {
    const dir = link.sessionDirectory || link.projectPath || projectDir()
    if (!dir || !link.sessionId) return
    navigate(`/${base64Encode(dir)}/session/${link.sessionId}`)
  }

  function handleUnlinkSession(linkId: string) {
    linkStore.removeLink(linkId)
    showToast({ title: "已解除测试会话关联", variant: "success" })
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
            agent={TEST_AGENT}
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
              该需求已关联 {testLinks().length} 个测试会话，是否继续创建新的测试会话？
            </p>
            <div class="flex items-center justify-end gap-2">
              <ButtonV2 size="small" variant="ghost" onClick={() => setShowCreateConfirm(false)}>
                {language.t("requirements.picker.cancel")}
              </ButtonV2>
              <ButtonV2 size="small" onClick={() => { setShowCreateConfirm(false); doCreateTestSession() }}>
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
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">加载测试详情失败</p>
              <ButtonV2 size="small" variant="ghost" onClick={() => refetch()}>
                {language.t("requirements.list.retry")}
              </ButtonV2>
            </div>
          </Show>

          <Show when={!data.loading && !data.error && !data()}>
            <div class="flex flex-col items-center gap-3 py-12">
              <Icon name="status" size="large" class="text-[var(--v2-text-text-faint)]" />
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">未找到该测试任务</p>
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

                <Show when={!developmentLocked()}>
                  <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    该开发产物尚未锁定。请先回到开发中心锁定开发产物，再进入测试。
                  </div>
                </Show>
                <Show when={developmentLocked() && !developmentDocument.loading && !developmentArtifact()}>
                  <div class="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[12px] text-[var(--v2-text-text-muted)]">
                    <span>未找到已生成的开发产物。测试文档需要基于上一步的开发产物生成。</span>
                    <ButtonV2 size="small" variant="ghost" onClick={handleBackToDevelopment}>
                      返回开发页
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
                            disabled={!canTest() || !document() || testLocked()}
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
                        disabled={!canTest() || !document() || saving() || !dirty() || testLocked()}
                        onClick={handleSave}
                        class="h-7 rounded-[5px] bg-[var(--v2-background-bg-button-neutral)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] shadow-[var(--v2-elevation-button-neutral)] transition-colors hover:bg-[var(--v2-overlay-simple-overlay-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving() ? "保存中" : "保存测试"}
                      </button>
                    </div>
                  </div>

                  <Show when={document.loading || developmentDocument.loading} fallback={
                    <Show
                      when={view() === "edit"}
                      fallback={
                        <Show
                          when={document()}
                          fallback={
                            <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                              <Show
                                when={canTest()}
                                fallback={
                                  <>
                                    <div class="flex flex-col gap-1">
                                      <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">等待开发产物</p>
                                      <p class="max-w-[430px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                        请先在开发中心生成并保存开发产物。锁定后的测试阶段会读取该产物作为测试智能体输入。
                                      </p>
                                    </div>
                                    <ButtonV2 size="small" onClick={handleBackToDevelopment}>
                                      查看开发产物
                                    </ButtonV2>
                                  </>
                                }
                              >
                                <div class="flex flex-col gap-1">
                                  <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">还没有测试产物</p>
                                  <p class="max-w-[460px] text-[12px] leading-relaxed text-[var(--v2-text-text-faint)]">
                                    页面会把已锁定的开发产物发送给 @测试智能体，由智能体生成并写入 04-test.md。
                                  </p>
                                </div>
                                <div class="flex items-center gap-2">
                                  <ButtonV2 size="small" onClick={handleCreateTestSession} disabled={creating() || testLocked()}>
                                    {creating() ? "创建中" : "调用 @测试智能体生成"}
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
                                cacheKey={`test-document-preview:${req().id}:${draft()}`}
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
                        disabled={!canTest() || !document() || testLocked()}
                        class="h-full min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)] disabled:opacity-60"
                        spellcheck={false}
                      />
                    </Show>
                  }>
                    <div class="flex flex-1 items-center justify-center p-4 text-[13px] text-[var(--v2-text-text-muted)]">
                      正在加载开发产物与测试文件...
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
                    锁定测试产物后，该需求的测试阶段将完成。
                  </p>
                </div>

                <div class="rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3 shadow-[inset_0_1px_0_var(--v2-alpha-light-10)]">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <h4 class="text-[11px] font-[530] text-[var(--v2-text-text-faint)]">测试智能体会话</h4>
                    <ButtonV2 size="small" variant="ghost-muted" icon="plus" disabled={!canTest() || testLocked()} onClick={handleAddToExisting}>
                      绑定已有会话
                    </ButtonV2>
                  </div>
                  <Show
                    when={hasTestLinks()}
                    fallback={
                      <button
                        type="button"
                        disabled={!canTest() || testLocked()}
                        onClick={handleAddToExisting}
                        class="flex w-full items-center justify-between gap-3 rounded-[6px] border border-dashed border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3 py-2.5 text-left transition-colors hover:border-[var(--v2-blue-400)]/60 hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span class="min-w-0">
                          <span class="block text-[12px] font-[530] text-[var(--v2-text-text-muted)]">暂无测试会话</span>
                          <span class="mt-0.5 block text-[11px] text-[var(--v2-text-text-faint)]">绑定后可从测试页快速回到测试智能体会话。</span>
                        </span>
                        <Icon name="plus" size="small" class="shrink-0 text-[var(--v2-blue-400)]" />
                      </button>
                    }
                  >
                    <div class="flex flex-col gap-1.5">
                      <For each={testLinks()}>
                        {(link) => (
                          <div
                            class="group relative overflow-hidden rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] transition-colors hover:border-[var(--v2-blue-400)]/50 hover:bg-[var(--v2-background-bg-layer-02)]"
                            onDblClick={() => handleOpenSession(link)}
                          >
                            <div class="absolute bottom-0 left-0 top-0 w-0.5 bg-[var(--v2-blue-400)]" />
                            <div class="flex items-center justify-between gap-2 px-2.5 py-2">
                              <div class="min-w-0">
                                <p class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]" title={link.sessionId}>
                                  {link.sessionTitle || sessionTitle(link.sessionId, "测试智能体会话")}
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
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canTest() || testLocked()} onClick={handleCreateTestSession}>
                      调用 @测试智能体
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={refreshingTest()} onClick={handleRefreshTestDocument}>
                      {refreshingTest() ? "刷新中..." : "刷新产物"}
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canTest() || !document() || !dirty() || testLocked()} onClick={handleSave}>
                      保存当前产物
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!canTest() || !document() || testLocked()} onClick={handleLockTest}>
                      锁定测试产物
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!testLocked()} onClick={() => showToast({ title: "测试已完成", variant: "success" })}>
                      完成测试
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" disabled={!developmentLocked() || testLocked()} onClick={handleUnlockDevelopment}>
                      解锁开发
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" class="w-full" onClick={handleBackToDevelopment}>
                      查看开发产物
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

export default function TestPage() {
  return (
    <RequirementsProvider>
      <TestContent />
    </RequirementsProvider>
  )
}
