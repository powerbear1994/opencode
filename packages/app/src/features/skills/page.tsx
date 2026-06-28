import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  Match,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { useParams, useSearchParams } from "@solidjs/router"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection, useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { decode64 } from "@/utils/base64"
import {
  filterSkills,
  SKILL_CATEGORY_LABELS,
  SKILL_SOURCE_LABELS,
  skillCategory,
  skillDirectory,
  skillSource,
  type SkillInfo,
  type SkillSource,
  type SkillSourceFilter,
} from "./model"

type SkillFile = {
  content: string
  editable: boolean
}

type SkillCreateSource = "project" | "global"
type DetailMode = "view" | "edit" | "create"

function ErrorFallback(err: Error, reset: () => void) {
  return (
    <div class="flex h-full w-full flex-col items-center justify-center gap-3">
      <p class="text-[13px] text-[var(--v2-text-text-muted)]">加载技能失败：{err.message}</p>
      <button
        type="button"
        onClick={reset}
        class="rounded-[6px] bg-[var(--v2-background-bg-layer-01)] px-3 py-1.5 text-[13px] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
      >
        重试
      </button>
    </div>
  )
}

export default function SkillsPage() {
  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <SkillsContent />
    </ErrorBoundary>
  )
}

function SkillsContent() {
  const params = useParams<{ dir?: string }>()
  const [searchParams] = useSearchParams<{ project?: string }>()
  const serverSDK = useServerSDK()
  const server = useServer()
  const dialog = useDialog()
  const [selected, setSelected] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [source, setSource] = createSignal<SkillSourceFilter>("all")
  const [mode, setMode] = createSignal<DetailMode>("view")
  const [draft, setDraft] = createSignal("")
  const [createName, setCreateName] = createSignal("")
  const [createDescription, setCreateDescription] = createSignal("")
  const [createSource, setCreateSource] = createSignal<SkillCreateSource>("project")
  const [createContent, setCreateContent] = createSignal("# 使用方式\n\n描述这个技能应该在什么情况下被加载。")
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<string>()
  const [actionError, setActionError] = createSignal<string>()
  const [smartName, setSmartName] = createSignal("")
  const [smartDescription, setSmartDescription] = createSignal("")
  const [smartGenerating, setSmartGenerating] = createSignal(false)
  const [smartError, setSmartError] = createSignal<string>()

  const directory = createMemo(() => {
    if (params.dir) return decode64(params.dir) ?? ""
    return searchParams.project ?? ""
  })

  const [data, { refetch }] = createResource(
    () => ({ sdk: serverSDK().client, directory: directory() }),
    async (input) => {
      const response = await input.sdk.app.skills(input.directory ? { directory: input.directory } : undefined)
      return response.data ?? []
    },
  )

  const skills = createMemo(() => data() as SkillInfo[] | undefined)
  const filtered = createMemo(() =>
    filterSkills({ skills: skills() ?? [], query: query(), source: source(), directory: directory() }),
  )
  const counts = createMemo(() => {
    const list = skills() ?? []
    return {
      all: list.length,
      "built-in": list.filter((skill) => skillSource(skill, directory()) === "built-in").length,
      project: list.filter((skill) => skillSource(skill, directory()) === "project").length,
      global: list.filter((skill) => skillSource(skill, directory()) === "global").length,
    }
  })
  const selectedSkill = createMemo(() => filtered().find((skill) => skill.name === selected()) ?? filtered()[0])

  const [skillFile, { refetch: refetchSkillFile }] = createResource(
    () => {
      const skill = selectedSkill()
      if (!skill || mode() === "create") return
      return { connection: server.current, directory: directory(), location: skill.location }
    },
    (input) =>
      requestSkill<SkillFile>(input.connection, {
        path: "/skill/file",
        directory: input.directory,
        query: { location: input.location },
      }),
  )

  createEffect(() => {
    const current = selected()
    if (mode() === "create") return
    if (current && filtered().some((skill) => skill.name === current)) return
    setSelected(filtered()[0]?.name)
  })

  createEffect(() => {
    const file = skillFile()
    if (!file) return
    setDraft(file.content)
    setActionError(undefined)
    setMessage(undefined)
  })

  createEffect(() => {
    if (directory()) return
    if (source() === "project") setSource("all")
    if (createSource() === "project") setCreateSource("global")
  })

  const selectedSource = () => {
    const skill = selectedSkill()
    if (!skill) return "global" as SkillSource
    return skillSource(skill, directory())
  }

  const selectSkill = (skill: SkillInfo) => {
    setSelected(skill.name)
    setMode("view")
  }

  const startCreate = () => {
    setMode("create")
    setSelected(undefined)
    setMessage(undefined)
    setActionError(undefined)
    setCreateSource(directory() ? "project" : "global")
  }

  const startSmartCreate = () => {
    setSmartName("")
    setSmartDescription("")
    setSmartError(undefined)
    setSmartGenerating(false)
    dialog.push(() => <SmartCreateDialog />)
  }

  const smartCreate = async () => {
    const name = smartName().trim()
    if (!name) {
      setSmartError("请输入技能名称。")
      return
    }
    setSmartGenerating(true)
    setSmartError(undefined)
    try {
      const result = await requestSkill<{ content: string }>(server.current, {
        path: "/skill/generate",
        method: "POST",
        directory: directory() || undefined,
        payload: {
          name,
          description: smartDescription().trim() || undefined,
        },
      })
      if (!result?.content) {
        setSmartError("AI 返回了空内容，请重试。")
        return
      }
      setCreateName(name)
      setCreateDescription(smartDescription().trim())
      setCreateContent(result.content)
      dialog.close()
      setMode("create")
      setSelected(undefined)
      setMessage(undefined)
      setActionError(undefined)
    } catch (err) {
      setSmartError(errorMessage(err))
    } finally {
      setSmartGenerating(false)
    }
  }

  const refresh = async (next?: string) => {
    await refetch()
    if (next) setSelected(next)
  }

  const save = async () => {
    const skill = selectedSkill()
    if (!skill) return
    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      const updated = await requestSkill<SkillInfo>(server.current, {
        path: "/skill",
        method: "PATCH",
        directory: directory(),
        payload: { location: skill.location, content: draft() },
      })
      await refresh(updated.name)
      await refetchSkillFile()
      setMode("view")
      setMessage("已保存技能。")
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      const description = createDescription().trim()
      const created = await requestSkill<SkillInfo>(server.current, {
        path: "/skill",
        method: "POST",
        directory: directory(),
        payload: {
          name: createName().trim(),
          ...(description ? { description } : {}),
          source: createSource(),
          content: createContent(),
        },
      })
      await refresh(created.name)
      setMode("view")
      setMessage("已创建技能。")
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const skill = selectedSkill()
    if (!skill) return
    if (!window.confirm(`删除技能 “${skill.name}”？这会删除它的 SKILL.md${skill.location.endsWith("/SKILL.md") ? " 和技能目录" : ""}。`)) return
    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      await requestSkill<boolean>(server.current, {
        path: "/skill",
        method: "DELETE",
        directory: directory(),
        payload: { location: skill.location },
      })
      setSelected(undefined)
      await refresh()
      setMode("view")
      setMessage("已删除技能。")
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function SmartCreateDialog() {
    return (
      <Dialog title="智能创建技能" size="x-large">
        <div class="flex flex-col gap-6 px-2 pb-2 pt-1">
          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-500)]">
                <Icon name="brain" size="small" class="size-4" />
              </span>
              <div class="min-w-0">
                <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">AI 智能生成</p>
                <p class="mt-0.5 text-[12px] leading-relaxed text-[var(--v2-text-text-muted)]">
                  输入名称和简介，AI 将自动生成完整的 SKILL.md 并填充到创建表单中
                </p>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <Show when={smartGenerating()}>
              <div class="flex flex-col items-center gap-3 rounded-[8px] border border-[var(--v2-blue-400)]/20 bg-[var(--v2-blue-400)]/4 px-4 py-6">
                <span class="inline-flex gap-1">
                  <span class="size-2 rounded-full bg-[var(--v2-blue-400)] animate-pulse" style="animation-delay:0ms" />
                  <span class="size-2 rounded-full bg-[var(--v2-blue-400)] animate-pulse" style="animation-delay:200ms" />
                  <span class="size-2 rounded-full bg-[var(--v2-blue-400)] animate-pulse" style="animation-delay:400ms" />
                </span>
                <div class="text-center">
                  <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">AI 正在生成 SKILL.md...</p>
                  <p class="mt-1 text-[12px] text-[var(--v2-text-text-muted)]">正在调用模型为 "{smartName()}" 生成完整技能文档，请稍候</p>
                </div>
              </div>
            </Show>

            <Show when={!smartGenerating()}>
            <label class="flex flex-col gap-1.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">
                名称
                <span class="ml-0.5 text-[var(--v2-red-400)]">*</span>
              </span>
              <input
                autofocus
                value={smartName()}
                onInput={(event) => setSmartName(event.currentTarget.value)}
                placeholder="输入技能名称，如 my-skill"
                disabled={smartGenerating()}
                class={inputClass()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault()
                }}
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">简介</span>
              <textarea
                value={smartDescription()}
                onInput={(event) => setSmartDescription(event.currentTarget.value)}
                placeholder="描述这个技能的功能、使用场景和触发条件"
                disabled={smartGenerating()}
                rows={4}
                class={inputClass() + " min-h-[80px] resize-none py-2 leading-relaxed"}
              />
              <span class="text-[11px] text-[var(--v2-text-text-faint)]">
                可选的补充说明，帮助 AI 更准确地生成技能内容
              </span>
            </label>
            </Show>
          </div>

          <Show when={smartError()}>
            <div class="flex items-start gap-2 rounded-[6px] border border-[var(--v2-red-400)]/30 bg-[var(--v2-red-400)]/8 px-3 py-2.5">
              <span class="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--v2-red-400)]/20 text-[var(--v2-red-500)] text-[10px] font-[700]">!</span>
              <p class="text-[12px] leading-relaxed text-[var(--v2-text-text-base)]">{smartError()}</p>
            </div>
          </Show>

          <div class="flex items-center justify-end gap-2.5 border-t border-[var(--v2-border-border-base)] pt-5">
            <button
              type="button"
              onClick={() => dialog.close()}
              disabled={smartGenerating()}
              class={secondaryButton()}
            >
              取消
            </button>
            <button
              type="button"
              onClick={smartCreate}
              disabled={smartGenerating() || !smartName().trim()}
              class={primaryButton()}
            >
              <Show
                when={smartGenerating()}
                fallback={
                  <span class="inline-flex items-center gap-1.5">
                    生成
                  </span>
                }
              >
                <span class="inline-flex items-center gap-1.5">
                  <span class="inline-flex gap-0.5">
                    <span class="size-1 rounded-full bg-current opacity-60 animate-pulse" style="animation-delay:0ms" />
                    <span class="size-1 rounded-full bg-current opacity-60 animate-pulse" style="animation-delay:150ms" />
                    <span class="size-1 rounded-full bg-current opacity-60 animate-pulse" style="animation-delay:300ms" />
                  </span>
                  正在生成...
                </span>
              </Show>
            </button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div class="shrink-0 border-b border-[var(--v2-border-border-base)] px-5 pb-3 pt-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-[16px] font-[530] leading-8 text-[var(--v2-text-text-base)]">技能</h1>
          </div>
          <button
            type="button"
            onClick={startCreate}
            class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
          >
            新建技能
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1">
        <Show when={mode() !== "create"}>
          <div class="flex h-full w-full shrink-0 flex-col border-r border-[var(--v2-border-border-base)] md:max-w-[360px]">
          <div class="shrink-0 px-4 pb-2 pt-3">
            <div class="flex items-center gap-1.5">
              <div class="relative flex h-8 flex-1 items-center">
                <span class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--v2-text-text-faint)]">
                  <Icon name="magnifying-glass" size="small" class="size-3.5" />
                </span>
                <input
                  type="search"
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder="搜索名称或描述..."
                  class="h-8 w-full rounded-[6px] border border-transparent bg-[var(--v2-background-bg-layer-01)] pl-8 pr-3 text-[13px] leading-8 text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
                />
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                class="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--v2-text-text-muted)] transition-colors hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--v2-text-text-base)]"
                aria-label="刷新技能列表"
              >
                <Icon name="arrow-undo-down" size="small" class="size-3.5" />
              </button>
            </div>
            <div class="mt-2 flex items-center gap-0.5 overflow-x-auto">
              <SourceTab active={source() === "all"} onClick={() => setSource("all")}>
                全部 {counts().all}
              </SourceTab>
              <SourceTab active={source() === "project"} disabled={!directory()} onClick={() => setSource("project")}>
                项目 {counts().project}
              </SourceTab>
              <SourceTab active={source() === "global"} onClick={() => setSource("global")}>
                全局 {counts().global}
              </SourceTab>
              <SourceTab active={source() === "built-in"} onClick={() => setSource("built-in")}>
                内置 {counts()["built-in"]}
              </SourceTab>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <Switch>
              <Match when={data.loading && filtered().length === 0}>
                <div class="flex flex-col gap-1 py-1">
                  <For each={[1, 2, 3, 4]}>{() => <div class="h-[74px] animate-pulse rounded-[8px] bg-[var(--v2-background-bg-layer-01)]" />}</For>
                </div>
              </Match>
              <Match when={data.error}>
                <div class="flex flex-col items-center gap-3 py-8">
                  <p class="text-[13px] text-[var(--v2-text-text-muted)]">无法读取技能列表。</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    class="rounded-[6px] bg-[var(--v2-background-bg-layer-01)] px-3 py-1.5 text-[13px] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                  >
                    重试
                  </button>
                </div>
              </Match>
              <Match when={filtered().length === 0 && mode() !== "create"}>
                <div class="flex flex-col items-center gap-2 py-12 text-center">
                  <Icon name="mcp" size="large" class="text-[var(--v2-text-text-faint)]" />
                  <p class="text-[13px] text-[var(--v2-text-text-muted)]">没有匹配的技能</p>
                </div>
              </Match>
              <Match when>
                <div class="flex flex-col gap-1">
                  <For each={filtered()}>
                    {(skill) => {
                      const active = () => mode() !== "create" && selectedSkill()?.name === skill.name
                      const currentSource = () => skillSource(skill, directory())
                      const currentCategory = () => skillCategory(skill, directory())
                      return (
                        <button
                          type="button"
                          class="group relative w-full rounded-[7px] border px-3 py-2 text-left transition-colors"
                          classList={{
                            "border-transparent bg-transparent hover:border-[var(--v2-border-border-base)] hover:bg-[var(--v2-background-bg-layer-01)]":
                              !active(),
                            "border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]": active(),
                          }}
                          onClick={() => selectSkill(skill)}
                        >
                          <Show when={active()}>
                            <div class="absolute bottom-1 left-0 top-1 w-[2.5px] rounded-r-[2px] bg-[var(--v2-blue-400)]" />
                          </Show>
                          <div class="flex min-w-0 items-center gap-2">
                            <span class="truncate text-[13px] font-[530] text-[var(--v2-text-text-base)]">
                              {skill.name}
                            </span>
                            <SourceBadge source={currentSource()} />
                          </div>
                          <p class="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--v2-text-text-muted)]">
                            {skill.description || "没有描述"}
                          </p>
                          <div class="mt-1 flex min-w-0 items-center gap-1.5">
                            <span class="shrink-0 text-[10px] text-[var(--v2-text-text-muted)]">
                              {SKILL_CATEGORY_LABELS[currentCategory()]}
                            </span>
                            <span class="min-w-0 truncate font-mono text-[10px] text-[var(--v2-text-text-faint)]">
                              {skillDirectory(skill)}
                            </span>
                          </div>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Match>
            </Switch>
          </div>
        </div>
        </Show>

        <div class="hidden min-w-0 flex-1 md:flex">
          <Show
            when={mode() === "create" || selectedSkill()}
            fallback={
              <div class="flex flex-1 items-center justify-center text-[13px] text-[var(--v2-text-text-muted)]">
                选择一个技能查看详情
              </div>
            }
          >
            <SkillDetail
              mode={mode()}
              setMode={setMode}
              skill={selectedSkill()}
              source={selectedSource()}
              directory={directory()}
              file={skillFile()}
              fileLoading={skillFile.loading}
              draft={draft()}
              setDraft={setDraft}
              createName={createName()}
              setCreateName={setCreateName}
              createDescription={createDescription()}
              setCreateDescription={setCreateDescription}
              createSource={createSource()}
              setCreateSource={setCreateSource}
              createContent={createContent()}
              setCreateContent={setCreateContent}
              canCreateProject={!!directory()}
              busy={busy()}
              message={message()}
              error={actionError() ?? (skillFile.error ? errorMessage(skillFile.error) : undefined)}
              onSave={save}
              onCreate={create}
              onDelete={remove}
              onSmartCreate={startSmartCreate}
            />
          </Show>
        </div>
      </div>

    </div>
  )
}

function SourceTab(props: { active: boolean; disabled?: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-[440] transition-colors"
      classList={{
        "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)]": props.active && !props.disabled,
        "text-[var(--v2-text-text-muted)] hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--v2-text-text-base)]":
          !props.active && !props.disabled,
        "cursor-not-allowed text-[var(--v2-text-text-faint)]": props.disabled,
      }}
    >
      {props.children}
    </button>
  )
}

function SourceBadge(props: { source: SkillSource }) {
  return (
    <span class="shrink-0 rounded-[3px] bg-[var(--v2-blue-400)]/10 px-1.5 py-px text-[10px] font-[530] leading-snug text-[var(--v2-blue-500)]">
      {SKILL_SOURCE_LABELS[props.source]}
    </span>
  )
}

function SkillDetail(props: {
  mode: DetailMode
  setMode: (mode: DetailMode) => void
  skill?: SkillInfo
  source: SkillSource
  directory: string
  file?: SkillFile
  fileLoading: boolean
  draft: string
  setDraft: (value: string) => void
  createName: string
  setCreateName: (value: string) => void
  createDescription: string
  setCreateDescription: (value: string) => void
  createSource: SkillCreateSource
  setCreateSource: (value: SkillCreateSource) => void
  createContent: string
  setCreateContent: (value: string) => void
  canCreateProject: boolean
  busy: boolean
  message?: string
  error?: string
  onSave: () => void
  onCreate: () => void
  onDelete: () => void
  onSmartCreate: () => void
}) {
  const builtin = () => props.skill?.location === "<built-in>"
  const editable = () => props.file?.editable === true && !builtin()

  return (
    <div class="flex h-full min-w-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-[var(--v2-border-border-base)] px-6 py-4">
        <Show
          when={props.mode !== "create"}
          fallback={
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate text-[18px] font-[530] text-[var(--v2-text-text-base)]">新建技能</h2>
                <p class="mt-1 text-[12px] text-[var(--v2-text-text-muted)]">创建后会立即重新加载技能列表。</p>
              </div>
              <div class="flex shrink-0 items-center" style="gap: 1rem">
                <button type="button" onClick={props.onSmartCreate} disabled={props.busy} class={secondaryButton()}>
                  智能创建
                </button>
                <button type="button" onClick={props.onCreate} disabled={props.busy || !props.createName.trim()} class={secondaryButton()}>
                  创建
                </button>
                <button type="button" onClick={() => props.setMode("view")} class={secondaryButton()}>
                  取消
                </button>
              </div>
            </div>
          }
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <h2 class="truncate text-[18px] font-[530] text-[var(--v2-text-text-base)]">{props.skill?.name}</h2>
                <SourceBadge source={props.source} />
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-4">
              <Show when={props.mode === "edit"}>
                <button type="button" onClick={props.onSave} disabled={props.busy} class={secondaryButton()}>
                  保存
                </button>
                <button type="button" onClick={() => props.setMode("view")} disabled={props.busy} class={secondaryButton()}>
                  取消
                </button>
              </Show>
              <Show when={editable() && props.mode === "view"}>
                <button type="button" onClick={() => props.setMode("edit")} class={secondaryButton()}>
                  编辑
                </button>
              </Show>
              <Show when={editable() && props.mode === "view"}>
                <button type="button" onClick={props.onDelete} disabled={props.busy} class={dangerButton()}>
                  删除
                </button>
              </Show>
              <Show when={!props.fileLoading && props.mode === "view" && !editable()}>
                <span class="inline-flex h-8 items-center rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-muted)]">
                  {builtin() ? "内置只读" : "只读"}
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <Show when={props.message}>
          <div class="mb-3 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 py-2 text-[12px] text-[var(--v2-text-text-muted)]">
            {props.message}
          </div>
        </Show>
        <Show when={props.error}>
          <div class="mb-3 rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 py-2 text-[12px] text-[var(--v2-text-text-base)]">
            {props.error}
          </div>
        </Show>

        <Switch>
          <Match when={props.mode === "create"}>
            <div class="min-w-0">
              <Show when={!props.canCreateProject}>
                <div class="mb-4 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 py-2 text-[12px] text-[var(--v2-text-text-muted)]">
                  未选择项目时只能创建全局技能；项目技能需要从具体项目进入后再创建。
                </div>
              </Show>
              <div class="flex min-w-0 flex-col">
                <Section title="基本信息" class="shrink-0">
                  <div class="grid gap-3 md:grid-cols-2">
                    <label class="flex min-w-0 flex-col gap-1.5">
                      <span class="text-[12px] text-[var(--v2-text-text-muted)]">名称</span>
                      <input
                        value={props.createName}
                        onInput={(event) => props.setCreateName(event.currentTarget.value)}
                        placeholder="my-skill"
                        class={inputClass()}
                      />
                    </label>
                    <label class="flex min-w-0 flex-col gap-1.5">
                      <span class="text-[12px] text-[var(--v2-text-text-muted)]">加载位置</span>
                      <select
                        value={props.createSource}
                        onChange={(event) => props.setCreateSource(event.currentTarget.value as SkillCreateSource)}
                        class={inputClass()}
                      >
                        <option value="project" disabled={!props.canCreateProject}>
                          项目 .opencode/skill
                        </option>
                        <option value="global">全局 ~/.claude/skills</option>
                      </select>
                    </label>
                  </div>
                  <label class="mt-3 flex min-w-0 flex-col gap-1.5">
                    <span class="text-[12px] text-[var(--v2-text-text-muted)]">描述</span>
                    <input
                      value={props.createDescription}
                      onInput={(event) => props.setCreateDescription(event.currentTarget.value)}
                      placeholder="什么时候应该加载这个技能"
                      class={inputClass()}
                    />
                  </label>
                </Section>

                <Section title="Markdown 内容" class="min-h-[320px]">
                  <MarkdownEditorPreview
                    value={props.createContent}
                    onInput={props.setCreateContent}
                    preview={props.createContent}
                    cacheKey={`skill-create-preview:${props.createName}:${props.createContent}`}
                  />
                </Section>
              </div>
            </div>
          </Match>

          <Match when={props.skill}>
            {(skill) => (
              <div class="flex min-w-0 flex-col">
                <div class="flex min-w-0 flex-col">
                  <Section title="文件位置" class="shrink-0">
                    <div class="grid gap-2 rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-3">
                      <MetaRow label="目录" value={skillDirectory(skill())} mono />
                      <MetaRow label="文件" value={skill().location} mono />
                    </div>
                  </Section>

                  <Section title={props.mode === "edit" ? "编辑 SKILL.md" : "SKILL.md"} class="min-h-[320px]">
                    <Show
                      when={!props.fileLoading}
                      fallback={<div class="h-[calc(100vh-370px)] min-h-[320px] animate-pulse rounded-[7px] bg-[var(--v2-background-bg-layer-01)]" />}
                    >
                      <Show
                        when={props.mode === "edit"}
                        fallback={
                          <pre class="h-[calc(100vh-370px)] min-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] p-4 text-[12px] leading-5 text-[var(--v2-text-text-base)]">
                            <code>{props.file?.content || "SKILL.md 内容为空。"}</code>
                          </pre>
                        }
                      >
                        <MarkdownEditorPreview
                          value={props.draft}
                          onInput={props.setDraft}
                          preview={markdownBody(props.draft)}
                          cacheKey={`skill-edit-preview:${skill().location}:${props.draft}`}
                        />
                      </Show>
                    </Show>
                  </Section>
                </div>
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function MarkdownEditorPreview(props: {
  value: string
  preview: string
  cacheKey: string
  onInput: (value: string) => void
}) {
  const [split, setSplit] = createSignal(50)
  let containerRef: HTMLDivElement | undefined
  let editorRef: HTMLTextAreaElement | undefined
  let previewRef: HTMLDivElement | undefined
  let syncing = false

  const onEditorScroll = () => {
    if (syncing || !editorRef || !previewRef) return
    syncing = true
    const max = editorRef.scrollHeight - editorRef.clientHeight
    if (max <= 0) { syncing = false; return }
    previewRef.scrollTop = (editorRef.scrollTop / max) * (previewRef.scrollHeight - previewRef.clientHeight)
    requestAnimationFrame(() => { syncing = false })
  }

  const onPreviewScroll = () => {
    if (syncing || !editorRef || !previewRef) return
    syncing = true
    const max = previewRef.scrollHeight - previewRef.clientHeight
    if (max <= 0) { syncing = false; return }
    editorRef.scrollTop = (previewRef.scrollTop / max) * (editorRef.scrollHeight - editorRef.clientHeight)
    requestAnimationFrame(() => { syncing = false })
  }

  const onDividerDown = (e: MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      if (!containerRef) return
      const rect = containerRef.getBoundingClientRect()
      setSplit(Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100)))
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <div
      ref={containerRef}
      class="flex h-[calc(100vh-290px)] min-h-[320px] overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]"
    >
      <textarea
        ref={editorRef}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onScroll={onEditorScroll}
        spellcheck={false}
        style={{ width: `${split()}%` }}
        class="min-h-0 resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
        placeholder="编辑 SKILL.md…"
      />
      <div
        class="flex shrink-0 cursor-col-resize items-center justify-center py-2"
        onMouseDown={onDividerDown}
      >
        <div class="h-full w-px bg-[var(--v2-border-border-base)]" />
      </div>
      <div
        ref={previewRef}
        onScroll={onPreviewScroll}
        style={{ width: `${100 - split()}%` }}
        class="min-h-0 min-w-0 overflow-y-auto p-4"
      >
        <Markdown
          text={props.preview || " "}
          cacheKey={props.cacheKey}
          class="text-[13px] leading-relaxed text-[var(--v2-text-text-base)]"
        />
      </div>
    </div>
  )
}

function markdownBody(content: string) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim()
}

function Section(props: { title: string; class?: string; children: JSX.Element }) {
  return (
    <section
      class="mb-5"
      classList={{
        [props.class ?? ""]: !!props.class,
      }}
    >
      <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">{props.title}</h3>
      {props.children}
    </section>
  )
}

function MetaRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-2 text-[12px]">
      <div class="text-[var(--v2-text-text-muted)]">{props.label}</div>
      <div
        class="min-w-0 truncate text-[var(--v2-text-text-base)]"
        classList={{ "font-mono text-[11px]": props.mono }}
        title={props.value}
      >
        {props.value}
      </div>
    </div>
  )
}

function inputClass() {
  return "h-8 min-w-0 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 text-[13px] text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
}

function secondaryButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-50"
}

function primaryButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--v2-text-text-base)] px-3 text-[12px] font-[530] text-[var(--v2-background-bg-base)] transition-opacity hover:opacity-90 disabled:opacity-50"
}

function dangerButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 text-[12px] font-[530] text-[var(--v2-red-600)] transition-colors hover:bg-[var(--v2-red-400)]/15 disabled:cursor-not-allowed disabled:opacity-60"
}

function requestSkill<T>(
  connection: ServerConnection.Any | undefined,
  input: {
    path: string
    method?: "GET" | "POST" | "PATCH" | "DELETE"
    directory?: string
    query?: Record<string, string>
    payload?: unknown
  },
) {
  if (!connection) throw new Error("当前服务器不可用。")
  const url = new URL(input.path, connection.http.url)
  if (input.directory) url.searchParams.set("directory", input.directory)
  Object.entries(input.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))

  const headers: Record<string, string> = {}
  if (input.payload !== undefined) headers["Content-Type"] = "application/json"
  if (connection.http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: connection.http.username,
      password: connection.http.password,
    })}`
  }

  return fetch(url, {
    method: input.method ?? "GET",
    headers,
    body: input.payload === undefined ? undefined : JSON.stringify(input.payload),
  }).then(async (response) => {
    const text = await response.text()
    const data = text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text
    if (!response.ok) throw new Error(errorMessage(data))
    return data as T
  })
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  if (typeof err === "string" && err.trim()) return err
  if (typeof err === "object" && err !== null) {
    const data = "data" in err ? err.data : undefined
    if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string") return data.message
    if ("message" in err && typeof err.message === "string") return err.message
    if ("error" in err && typeof err.error === "string") return err.error
  }
  return "操作失败。"
}
