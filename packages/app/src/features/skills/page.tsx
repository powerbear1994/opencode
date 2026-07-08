import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
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
import { useModels } from "@/context/models"
import { authTokenFromCredentials } from "@/utils/server"
import { decode64 } from "@/utils/base64"
import {
  filterSkills,
  SKILL_SOURCE_LABELS,
  skillSource,
  type SkillInfo,
  type SkillSource,
  type SkillSourceFilter,
} from "./model"

type SkillFile = {
  content: string
  editable: boolean
  path: string
  files: { path: string; type: "file" }[]
}

type GeneratedSkill = {
  name: string
  description: string
  content: string
}

type DraftSkillFile = {
  path: string
  type: "file"
  content: string
}

type SkillCreateSource = "project" | "global"
type DetailMode = "view" | "edit" | "create"
type ModelOption = {
  value: string
  label: string
  provider: string
}

const DEFAULT_CREATE_BODY = [
  "# 使用方式",
  "",
  "## 何时调用",
  "",
  "- ",
  "",
  "## 工作流程",
  "",
  "1. ",
  "",
  "## 输出要求",
  "",
  "- ",
  "",
  "## 约束",
  "",
  "- ",
].join("\n")
const MIN_SMART_DESCRIPTION_LENGTH = 20

function ErrorFallback(err: Error, reset: () => void) {
  return (
    <div class="flex h-full w-full flex-col items-center justify-center gap-3">
      <p class="text-[13px] text-[var(--v2-text-text-muted)]">加载技能失败：{err.message}</p>
      <button type="button" onClick={reset} class={secondaryButton()}>
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
  const models = useModels()
  const [selected, setSelected] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [source, setSource] = createSignal<SkillSourceFilter>("all")
  const [mode, setMode] = createSignal<DetailMode>("view")
  const [draft, setDraft] = createSignal("")
  const [selectedFile, setSelectedFile] = createSignal("SKILL.md")
  const [createName, setCreateName] = createSignal("")
  const [createDescription, setCreateDescription] = createSignal("")
  const [createSource, setCreateSource] = createSignal<SkillCreateSource>("project")
  const [createContent, setCreateContent] = createSignal(skillDocumentDraft("", "", DEFAULT_CREATE_BODY))
  const [createFiles, setCreateFiles] = createSignal<DraftSkillFile[]>([])
  const [createSelectedFile, setCreateSelectedFile] = createSignal("SKILL.md")
  const [createSelectedDirectory, setCreateSelectedDirectory] = createSignal("")
  const [selectedDirectory, setSelectedDirectory] = createSignal("references")
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<string>()
  const [actionError, setActionError] = createSignal<string>()
  const [smartName, setSmartName] = createSignal("")
  const [smartDescription, setSmartDescription] = createSignal("")
  const [smartModel, setSmartModel] = createSignal("")
  const [smartGenerating, setSmartGenerating] = createSignal(false)
  const [smartError, setSmartError] = createSignal<string>()
  const [newFileName, setNewFileName] = createSignal("")
  const [newFileDirectory, setNewFileDirectory] = createSignal("references")
  const [newFileError, setNewFileError] = createSignal<string>()
  const [pendingAddFile, setPendingAddFile] = createSignal<((input: { path: string; content: string }) => void) | undefined>()

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
  const smartModelOptions = createMemo<ModelOption[]>(() =>
    models
      .list()
      .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id }))
      .map((model) => ({
        value: `${model.provider.id}/${model.id}`,
        label: model.name,
        provider: model.provider.name,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)),
  )
  const selectedSmartModel = createMemo(() => smartModelOptions().find((option) => option.value === smartModel()))

  const [skillFile, { refetch: refetchSkillFile }] = createResource(
    () => {
      const skill = selectedSkill()
      if (!skill || mode() === "create") return
      return { connection: server.current, directory: directory(), location: skill.location, file: selectedFile() }
    },
    (input) =>
      requestSkill<SkillFile>(input.connection, {
        path: "/skill/file",
        directory: input.directory,
        query: { location: input.location, file: input.file },
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
    setSelectedFile(file.path)
    setSelectedDirectory(parentSkillDirectory(file.path))
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
    setSelectedFile("SKILL.md")
    setSelectedDirectory("")
    setMode("view")
  }

  const resetCreateForm = () => {
    setCreateName("")
    setCreateDescription("")
    setCreateContent(skillDocumentDraft("", "", DEFAULT_CREATE_BODY))
    setCreateFiles([])
    setCreateSelectedFile("SKILL.md")
    setCreateSelectedDirectory("")
    setCreateSource(directory() ? "project" : "global")
  }

  const startCreate = () => {
    resetCreateForm()
    setMode("create")
    setSelected(undefined)
    setMessage(undefined)
    setActionError(undefined)
  }

  const cancelCreate = () => {
    resetCreateForm()
    setMode("view")
    setMessage(undefined)
    setActionError(undefined)
  }

  const startSmartCreate = () => {
    setSmartName("")
    setSmartDescription("")
    setSmartModel("")
    setSmartError(undefined)
    setSmartGenerating(false)
    dialog.push(() => <SmartCreateDialog />)
  }

  const startAddFile = (handler: (input: { path: string; content: string }) => void, directory: string) => {
    setNewFileName(defaultSkillFileName(directory))
    setNewFileDirectory(directory)
    setNewFileError(undefined)
    setPendingAddFile(() => handler)
    dialog.push(() => <NewSkillFileDialog />)
  }

  const submitNewFile = () => {
    const file = normalizeSkillDraftPath([newFileDirectory(), newFileName()].filter(Boolean).join("/"))
    if (!file) {
      setNewFileError("请输入有效的文件名。")
      return
    }
    pendingAddFile()?.({ path: file, content: skillFileTemplate(file) })
    setPendingAddFile(undefined)
    dialog.close()
  }

  const createTreeFiles = createMemo(() => [{ path: "SKILL.md", type: "file" as const }, ...createFiles().map((item) => ({ path: item.path, type: item.type }))])
  const createActiveFile = createMemo(() => {
    if (createSelectedFile() === "SKILL.md") {
      return { path: "SKILL.md", type: "file" as const, content: createContent() }
    }
    return createFiles().find((item) => item.path === createSelectedFile()) ?? { path: "SKILL.md", type: "file" as const, content: createContent() }
  })
  const selectCreateFile = (file: string) => {
    setCreateSelectedFile(file)
    setCreateSelectedDirectory(parentSkillDirectory(file))
  }
  const selectExistingFile = (file: string) => {
    setSelectedFile(file)
    setSelectedDirectory(parentSkillDirectory(file))
  }
  const setCreateNameSynced = (name: string) => {
    setCreateName(name)
    setCreateContent((content) => syncSkillFrontmatter(content, name, createDescription()))
  }
  const setCreateDescriptionSynced = (description: string) => {
    setCreateDescription(description)
    setCreateContent((content) => syncSkillFrontmatter(content, createName(), description))
  }
  const setCreateSkillContent = (content: string) => {
    setCreateContent(content)
    const metadata = parseSkillFrontmatter(content)
    if (metadata?.name !== undefined) setCreateName(metadata.name)
    if (metadata?.description !== undefined) setCreateDescription(metadata.description)
  }
  const setCreateActiveContent = (content: string) => {
    if (createSelectedFile() === "SKILL.md") {
      setCreateSkillContent(content)
      return
    }
    setCreateFiles((files) => files.map((item) => item.path === createSelectedFile() ? { ...item, content } : item))
  }

  const addCreateFile = (input: { path: string; content: string }) => {
    const file = normalizeSkillDraftPath(input.path)
    if (!file) {
      setActionError("文件路径无效。")
      return
    }
    if (file === "SKILL.md" || createFiles().some((item) => item.path === file)) {
      setActionError("文件已存在。")
      setCreateSelectedFile(file)
      setCreateSelectedDirectory(parentSkillDirectory(file))
      return
    }
    setCreateFiles((files) => [...files, { path: file, type: "file", content: input.content }])
    setCreateSelectedFile(file)
    setCreateSelectedDirectory(parentSkillDirectory(file))
    setActionError(undefined)
  }

  const addExistingSkillFile = async (input: { path: string; content: string }) => {
    const skill = selectedSkill()
    if (!skill) return
    const file = normalizeSkillDraftPath(input.path)
    if (!file) {
      setActionError("文件路径无效。")
      return
    }
    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      await requestSkill<SkillInfo>(server.current, {
        path: "/skill",
        method: "PATCH",
        directory: directory(),
        payload: { location: skill.location, file, content: input.content },
      })
      setSelectedFile(file)
      setSelectedDirectory(parentSkillDirectory(file))
      await refetchSkillFile()
      setMode("edit")
      setMessage("已添加技能文件。")
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const smartCreate = async () => {
    const name = smartName().trim()
    const description = smartDescription().trim()
    if (!name) {
      setSmartError("请输入技能名称。")
      return
    }
    if (!description) {
      setSmartError("请输入技能需求。")
      return
    }
    if (description.length < MIN_SMART_DESCRIPTION_LENGTH) {
      setSmartError(`技能需求至少需要 ${MIN_SMART_DESCRIPTION_LENGTH} 个字符。`)
      return
    }
    setSmartGenerating(true)
    setSmartError(undefined)
    try {
      const result = await requestSkill<GeneratedSkill>(server.current, {
        path: "/skill/generate",
        method: "POST",
        directory: directory() || undefined,
        payload: {
          name,
          description,
          model: modelSelection(smartModel()),
        },
      })
      if (!result?.content) {
        setSmartError("AI 返回了空内容，请重试。")
        return
      }
      const generatedName = result.name || name
      setCreateName(generatedName)
      setCreateDescription(result.description)
      setCreateContent(skillDocumentDraft(generatedName, result.description, markdownBody(result.content) || result.content))
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
        payload: { location: skill.location, file: selectedFile(), content: draft() },
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
          content: syncSkillFrontmatter(createContent(), createName().trim(), description),
          files: createFiles().map((item) => ({ path: item.path, content: item.content })),
        },
      })
      await refresh(created.name)
      resetCreateForm()
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
      <Dialog title="智能生成技能" size="x-large">
        <div class="flex flex-col gap-6 px-2 pb-2 pt-1">
          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-500)]">
                <Icon name="brain" size="small" class="size-4" />
              </span>
              <div class="min-w-0">
                <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">AI 智能生成</p>
                <p class="mt-0.5 text-[12px] leading-relaxed text-[var(--v2-text-text-muted)]">
                  输入名称和技能需求，AI 会生成简介和正文，并填充到创建表单中
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
                  <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">AI 正在生成 SKILL.md</p>
                  <p class="mt-1 text-[12px] text-[var(--v2-text-text-muted)]">正在调用模型生成技能草稿，请稍候</p>
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
                placeholder="例如：database-migration-review"
                disabled={smartGenerating()}
                class={inputClass()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault()
                }}
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">
                技能需求
                <span class="ml-0.5 text-[var(--v2-red-400)]">*</span>
              </span>
              <textarea
                value={smartDescription()}
                onInput={(event) => setSmartDescription(event.currentTarget.value)}
                placeholder="描述这个技能的功能、使用场景、触发条件和期望输出"
                disabled={smartGenerating()}
                rows={4}
                class={inputClass() + " min-h-[80px] resize-none py-2 leading-relaxed"}
              />
              <span class="text-[11px] text-[var(--v2-text-text-faint)]">
                至少 {MIN_SMART_DESCRIPTION_LENGTH} 个字符
              </span>
            </label>

            <label class="flex flex-col gap-2 rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-00)] px-3 py-2.5">
              <span class="flex flex-col gap-0.5">
                <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">生成模型</span>
                <span class="text-[11px] leading-4 text-[var(--v2-text-text-muted)]">
                  仅用于生成这份技能草稿；不选择时使用默认模型。
                </span>
              </span>
              <SelectV2
                appearance="large"
                placeholder="使用默认模型"
                options={smartModelOptions()}
                current={selectedSmartModel()}
                value={(option) => option.value}
                label={(option) => `${option.provider} / ${option.label}`}
                groupBy={(option) => option.provider}
                onSelect={(option) => setSmartModel(option?.value ?? "")}
                style={{ width: "100%" }}
              />
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
              disabled={
                smartGenerating() ||
                !smartName().trim() ||
                smartDescription().trim().length < MIN_SMART_DESCRIPTION_LENGTH
              }
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
                <span class="inline-flex items-center gap-1.5">正在生成</span>
              </Show>
            </button>
          </div>
        </div>
      </Dialog>
    )
  }

  function NewSkillFileDialog() {
    return (
      <Dialog title="新建文件" size="normal">
        <div class="flex flex-col gap-4 px-2 pb-2 pt-1">
          <label class="flex flex-col gap-1.5">
            <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">创建位置</span>
            <div class="h-8 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 font-mono text-[12px] leading-8 text-[var(--v2-text-text-muted)]">
              {newFileDirectory() || "技能根目录"}
            </div>
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">文件名</span>
            <input
              autofocus
              value={newFileName()}
              onInput={(event) => {
                setNewFileName(event.currentTarget.value)
                setNewFileError(undefined)
              }}
              placeholder={defaultSkillFileName(newFileDirectory())}
              class={inputClass()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submitNewFile()
                }
              }}
            />
            <span class="text-[11px] text-[var(--v2-text-text-faint)]">先在左侧文件树选择目录，再创建文件。</span>
          </label>
          <Show when={newFileError()}>
            <div class="rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 py-2 text-[12px] text-[var(--v2-text-text-base)]">
              {newFileError()}
            </div>
          </Show>
          <div class="flex items-center justify-end gap-2.5 border-t border-[var(--v2-border-border-base)] pt-4">
            <button
              type="button"
              onClick={() => {
                setPendingAddFile(undefined)
                dialog.close()
              }}
              class={secondaryButton()}
            >
              取消
            </button>
            <button type="button" onClick={submitNewFile} disabled={!newFileName().trim()} class={primaryButton()}>
              创建
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
            <div>
              <h1 class="text-[16px] font-[530] leading-8 text-[var(--v2-text-text-base)]">技能库</h1>
              <p class="text-[12px] leading-5 text-[var(--v2-text-text-muted)]">管理当前项目与全局可用的技能能力</p>
            </div>
          </div>
          <Show when={mode() === "view"}>
            <button type="button" onClick={startCreate} class={secondaryButton()}>
              新建技能
            </button>
          </Show>
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
                  <button type="button" onClick={() => void refetch()} class={secondaryButton()}>
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
                      return (
                        <button
                          type="button"
                          class="group relative w-full rounded-[7px] border px-3 py-2 text-left transition-colors"
                          classList={{
                            "border-transparent bg-transparent hover:border-[var(--v2-border-border-base)] hover:bg-[var(--v2-background-bg-layer-01)]":
                              !active(),
                            "border-[var(--v2-blue-400)]/30 bg-[var(--v2-blue-400)]/5": active(),
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
              selectedFile={selectedFile()}
              setSelectedFile={selectExistingFile}
              selectedDirectory={selectedDirectory()}
              setSelectedDirectory={setSelectedDirectory}
              fileLoading={skillFile.loading}
              draft={draft()}
              setDraft={setDraft}
              createName={createName()}
              setCreateName={setCreateNameSynced}
              createDescription={createDescription()}
              setCreateDescription={setCreateDescriptionSynced}
              createSource={createSource()}
              setCreateSource={setCreateSource}
              createContent={createContent()}
              setCreateContent={setCreateSkillContent}
              createFiles={createTreeFiles()}
              createActiveFile={createActiveFile()}
              setCreateSelectedFile={selectCreateFile}
              createSelectedDirectory={createSelectedDirectory()}
              setCreateSelectedDirectory={setCreateSelectedDirectory}
              setCreateActiveContent={setCreateActiveContent}
              canCreateProject={!!directory()}
              busy={busy()}
              message={message()}
              error={actionError() ?? (skillFile.error ? errorMessage(skillFile.error) : undefined)}
              onSave={save}
              onCreate={create}
              onDelete={remove}
              onSmartCreate={startSmartCreate}
              onCancelCreate={cancelCreate}
              onAddCreateFile={() => startAddFile(addCreateFile, createSelectedDirectory() || "references")}
              onAddExistingFile={() => startAddFile(addExistingSkillFile, selectedDirectory())}
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
    <span
      class="shrink-0 rounded-[3px] px-1.5 py-px text-[10px] font-[530] leading-snug"
      classList={{
        "bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-500)]": props.source === "project",
        "bg-[var(--v2-green-400)]/10 text-[var(--v2-green-600)]": props.source === "global",
        "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-muted)]": props.source === "built-in",
      }}
    >
      {SKILL_SOURCE_LABELS[props.source]}
    </span>
  )
}

type SkillTreeEntry = {
  path: string
  label: string
  depth: number
  type: "directory" | "file"
}

const DEFAULT_SKILL_DIRECTORIES = ["references", "scripts", "assets"]

function normalizeSkillDraftPath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "")
  if (!normalized || normalized.includes("\0")) return
  const parts = normalized.split("/").filter((part) => part && part !== ".")
  if (parts.length === 0 || parts.some((part) => part === "..")) return
  return parts.join("/")
}

function skillFileTemplate(file: string) {
  if (file.startsWith("references/") && isMarkdownFile(file)) return `# ${file.split("/").at(-1)?.replace(/\.md$/i, "") ?? "Reference"}\n\n`
  if (file.startsWith("scripts/")) return "#!/usr/bin/env bash\nset -euo pipefail\n\n"
  if (file.startsWith("assets/") && isMarkdownFile(file)) return "# Asset\n\n"
  return ""
}

function parentSkillDirectory(file: string) {
  const parts = normalizeSkillDraftPath(file)?.split("/") ?? []
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}

function defaultSkillFileName(directory: string) {
  if (directory.startsWith("scripts")) return "script.sh"
  if (directory.startsWith("assets")) return "template.md"
  return "notes.md"
}

function skillTreeEntries(files: { path: string; type: "file" }[], showEmptyDirs: boolean) {
  const entries = new Map<string, SkillTreeEntry>()
  if (showEmptyDirs) {
    DEFAULT_SKILL_DIRECTORIES.forEach((dir) => {
      entries.set(dir, {
        path: dir,
        label: dir,
        depth: 0,
        type: "directory",
      })
    })
  }
  files.forEach((file) => {
    const parts = file.path.split("/").filter(Boolean)
    parts.slice(0, -1).forEach((_, index) => {
      const dir = parts.slice(0, index + 1).join("/")
      if (!entries.has(dir)) {
        entries.set(dir, {
          path: dir,
          label: parts[index] ?? dir,
          depth: index,
          type: "directory",
        })
      }
    })
    entries.set(file.path, {
      path: file.path,
      label: parts.at(-1) ?? file.path,
      depth: Math.max(0, parts.length - 1),
      type: "file",
    })
  })
  return Array.from(entries.values()).toSorted((a, b) => {
    if (a.path === "SKILL.md") return -1
    if (b.path === "SKILL.md") return 1
    return a.path.localeCompare(b.path)
  })
}

function isMarkdownFile(file: string) {
  return file.toLowerCase().endsWith(".md") || file.toLowerCase().endsWith(".markdown")
}

function SkillFileTree(props: {
  files: { path: string; type: "file" }[]
  active: string
  activeDirectory: string
  onSelect: (path: string) => void
  onSelectDirectory: (path: string) => void
  onAddFile?: () => void
  canAdd?: boolean
  showEmptyDirs?: boolean
}) {
  const entries = createMemo(() => skillTreeEntries(props.files, props.showEmptyDirs ?? false))
  const directoryHasFiles = (directory: string) => props.files.some((file) => file.path.startsWith(`${directory}/`))
  const selectEntry = (entry: SkillTreeEntry) => {
    if (entry.type === "directory") {
      props.onSelectDirectory(entry.path)
      return
    }
    props.onSelect(entry.path)
  }
  return (
    <div class="h-full w-[220px] shrink-0 overflow-y-auto border-r border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] p-2">
      <div class="mb-2 flex h-7 items-center justify-between px-2">
        <span class="text-[11px] font-[530] text-[var(--v2-text-text-muted)]">文件</span>
        <Show when={props.canAdd && props.onAddFile}>
          <button
            type="button"
            onClick={() => props.onAddFile?.()}
            class="flex size-6 items-center justify-center rounded-[5px] text-[var(--v2-text-text-muted)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--v2-text-text-base)]"
            title="在选中目录中新建文件"
            aria-label="新建文件"
          >
            <Icon name="plus" size="small" class="size-3.5" />
          </button>
        </Show>
      </div>
      <For each={entries()}>
        {(entry) => (
          <button
            type="button"
            onClick={() => selectEntry(entry)}
            class="flex h-7 w-full items-center gap-1.5 rounded-[5px] px-2 text-left text-[12px] transition-colors"
            style={{ "padding-left": `${8 + entry.depth * 14}px` }}
            classList={{
              "text-[var(--v2-text-text-muted)] hover:bg-[var(--v2-background-bg-layer-02)]": entry.type === "directory" && entry.path !== props.activeDirectory && directoryHasFiles(entry.path),
              "text-[var(--v2-text-text-faint)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--v2-text-text-muted)]": entry.type === "directory" && entry.path !== props.activeDirectory && !directoryHasFiles(entry.path),
              "border border-[var(--v2-blue-400)]/45 bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-600)]": entry.type === "directory" && entry.path === props.activeDirectory,
              "text-[var(--v2-text-text-base)] hover:bg-[var(--v2-background-bg-layer-02)]": entry.type === "file" && entry.path !== props.active,
              "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)]": entry.type === "file" && entry.path === props.active,
            }}
            title={entry.type === "directory" ? `${directoryHasFiles(entry.path) ? "" : "空目录，"}新文件将创建到 ${entry.path}` : entry.path}
          >
            <Icon name={entry.type === "directory" ? "folder" : "mcp"} size="small" class="size-3.5 shrink-0 text-[var(--v2-text-text-faint)]" />
            <span class="min-w-0 truncate">{entry.label}</span>
          </button>
        )}
      </For>
    </div>
  )
}

function SkillDetail(props: {
  mode: DetailMode
  setMode: (mode: DetailMode) => void
  skill?: SkillInfo
  source: SkillSource
  directory: string
  file?: SkillFile
  selectedFile: string
  setSelectedFile: (value: string) => void
  selectedDirectory: string
  setSelectedDirectory: (value: string) => void
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
  createFiles: { path: string; type: "file" }[]
  createActiveFile: DraftSkillFile
  setCreateSelectedFile: (value: string) => void
  createSelectedDirectory: string
  setCreateSelectedDirectory: (value: string) => void
  setCreateActiveContent: (value: string) => void
  canCreateProject: boolean
  busy: boolean
  message?: string
  error?: string
  onSave: () => void
  onCreate: () => void
  onDelete: () => void
  onSmartCreate: () => void
  onCancelCreate: () => void
  onAddCreateFile: () => void
  onAddExistingFile: () => void
}) {
  const [copied, setCopied] = createSignal(false)
  const builtin = () => props.skill?.location === "<built-in>"
  const editable = () => props.file?.editable === true && !builtin()
  const activeFile = () => props.file?.path ?? props.selectedFile
  const activeFileMarkdown = () => isMarkdownFile(activeFile())

  const copySkillPath = async () => {
    const skill = props.skill
    if (!skill || builtin()) return
    try {
      await navigator.clipboard.writeText(skill.location)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

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
              <div class="flex shrink-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={props.onSmartCreate}
                  disabled={props.busy}
                  class={secondaryButton()}
                >
                  智能生成
                </button>
                <button type="button" onClick={props.onCreate} disabled={props.busy || !props.createName.trim()} class={primaryButton()}>
                  保存
                </button>
                <button type="button" onClick={props.onCancelCreate} class={secondaryButton()}>
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
              <p class="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--v2-text-text-muted)]">
                {props.skill?.description || "没有描述"}
              </p>
              <Show when={props.skill}>
                {(skill) => (
                  <p class="mt-1 truncate font-mono text-[10px] text-[var(--v2-text-text-faint)]" title={skill().location}>
                    {skill().location}
                  </p>
                )}
              </Show>
            </div>
            <div class="flex shrink-0 items-center gap-2.5">
              <Show when={props.mode === "edit"}>
                <button type="button" onClick={props.onSave} disabled={props.busy} class={primaryButton()}>
                  保存
                </button>
                <button type="button" onClick={() => props.setMode("view")} disabled={props.busy} class={secondaryButton()}>
                  取消
                </button>
              </Show>
              <Show when={editable() && props.mode === "view"}>
                <button type="button" onClick={copySkillPath} class={secondaryButton()}>
                  {copied() ? "已复制" : "复制路径"}
                </button>
                <button type="button" onClick={() => props.setMode("edit")} class={secondaryButton()}>
                  编辑
                </button>
              </Show>
              <Show when={editable() && props.mode === "view"}>
                <button type="button" onClick={props.onDelete} disabled={props.busy} class={secondaryButton() + " hover:border-[var(--v2-red-400)]/40 hover:bg-[var(--v2-red-400)]/10 hover:text-[var(--v2-red-600)]"}>
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
                <Section title="元数据" class="shrink-0">
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
                  <p class="mt-2 text-[11px] leading-relaxed text-[var(--v2-text-text-faint)]">
                    名称和描述会同步到 SKILL.md frontmatter；其他高级字段可直接在 SKILL.md 顶部 YAML 中编辑。
                  </p>
                </Section>

                <Section title="技能文件" class="min-h-[320px]">
                  <div class="flex h-[calc(100vh-235px)] min-h-[320px] overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]">
                    <SkillFileTree
                      files={props.createFiles}
                      active={props.createActiveFile.path}
                      activeDirectory={props.createSelectedDirectory}
                      onSelect={props.setCreateSelectedFile}
                      onSelectDirectory={props.setCreateSelectedDirectory}
                      onAddFile={props.onAddCreateFile}
                      canAdd
                      showEmptyDirs
                    />
                    <div class="min-w-0 flex-1">
                      <Show
                        when={isMarkdownFile(props.createActiveFile.path)}
                        fallback={
                          <textarea
                            value={props.createActiveFile.content}
                            onInput={(event) => props.setCreateActiveContent(event.currentTarget.value)}
                            spellcheck={false}
                            class="h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
                          />
                        }
                      >
                        <MarkdownEditorPreview
                          value={props.createActiveFile.content}
                          onInput={props.setCreateActiveContent}
                          preview={props.createActiveFile.path === "SKILL.md" ? markdownBody(props.createContent) : props.createActiveFile.content}
                          cacheKey={`skill-create-preview:${props.createName}:${props.createActiveFile.path}:${props.createActiveFile.content}`}
                          framed={false}
                        />
                      </Show>
                    </div>
                  </div>
                </Section>
              </div>
            </div>
          </Match>

          <Match when={props.skill}>
            {(skill) => (
              <div class="flex min-w-0 flex-col">
                <div class="flex min-w-0 flex-col">
                  <Show
                    when={!props.fileLoading}
                    fallback={<div class="h-[calc(100vh-265px)] min-h-[320px] animate-pulse rounded-[7px] bg-[var(--v2-background-bg-layer-01)]" />}
                  >
                    <div class="flex h-[calc(100vh-265px)] min-h-[320px] overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]">
                      <SkillFileTree
                        files={props.file?.files ?? [{ path: "SKILL.md", type: "file" }]}
                        active={activeFile()}
                        activeDirectory={props.selectedDirectory}
                        onSelect={props.setSelectedFile}
                        onSelectDirectory={props.setSelectedDirectory}
                        onAddFile={props.onAddExistingFile}
                        canAdd={editable() && props.mode === "edit"}
                        showEmptyDirs={props.mode === "edit"}
                      />
                      <div class="min-w-0 flex-1">
                        <Show
                          when={props.mode === "edit"}
                          fallback={
                            <Show
                              when={activeFileMarkdown()}
                              fallback={
                                <pre class="h-full overflow-y-auto whitespace-pre-wrap break-words p-4 text-[12px] leading-5 text-[var(--v2-text-text-base)]">
                                  <code>{props.file?.content || `${activeFile()} 内容为空。`}</code>
                                </pre>
                              }
                            >
                              <div class="h-full overflow-y-auto p-4">
                                <Markdown
                                  text={activeFile() === "SKILL.md" ? markdownBody(props.file?.content ?? "") : (props.file?.content ?? " ")}
                                  cacheKey={`skill-view-preview:${skill().location}:${activeFile()}:${props.file?.content ?? ""}`}
                                  class="text-[13px] leading-relaxed text-[var(--v2-text-text-base)]"
                                />
                              </div>
                            </Show>
                          }
                        >
                          <Show
                            when={activeFileMarkdown()}
                            fallback={
                              <textarea
                                value={props.draft}
                                onInput={(event) => props.setDraft(event.currentTarget.value)}
                                spellcheck={false}
                                class="h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
                              />
                            }
                          >
                            <MarkdownEditorPreview
                              value={props.draft}
                              onInput={props.setDraft}
                              preview={activeFile() === "SKILL.md" ? markdownBody(props.draft) : props.draft}
                              cacheKey={`skill-edit-preview:${skill().location}:${activeFile()}:${props.draft}`}
                              framed={false}
                            />
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </Show>
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
  framed?: boolean
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
      classList={{
        "flex h-full min-h-[320px] flex-col overflow-hidden bg-[var(--v2-background-bg-layer-01)]": props.framed === false,
        "flex h-[calc(100vh-290px)] min-h-[320px] flex-col overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]":
          props.framed !== false,
      }}
    >
      <div class="flex h-8 shrink-0 border-b border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)]">
        <div
          style={{ width: `${split()}%` }}
          class="flex items-center px-4 text-[11px] font-[530] text-[var(--v2-text-text-muted)]"
        >
          编辑
        </div>
        <div class="w-px bg-[var(--v2-border-border-base)]" />
        <div
          style={{ width: `${100 - split()}%` }}
          class="flex items-center px-4 text-[11px] font-[530] text-[var(--v2-text-text-muted)]"
        >
          预览
        </div>
      </div>
      <div class="flex min-h-0 flex-1">
        <textarea
          ref={editorRef}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onScroll={onEditorScroll}
          spellcheck={false}
          style={{ width: `${split()}%` }}
          class="h-full min-h-0 resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
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
          class="h-full min-h-0 min-w-0 overflow-y-auto p-4"
        >
          <Markdown
            text={props.preview || " "}
            cacheKey={props.cacheKey}
            class="text-[13px] leading-relaxed text-[var(--v2-text-text-base)]"
          />
        </div>
      </div>
    </div>
  )
}

function markdownBody(content: string) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim()
}

function skillDocumentDraft(name: string, description: string, body: string) {
  return syncSkillFrontmatter(body, name, description)
}

function syncSkillFrontmatter(content: string, name: string, description: string) {
  const parsed = splitSkillFrontmatter(content)
  const body = parsed?.body ?? content
  const lines = parsed?.frontmatter.split("\n") ?? []
  const withName = upsertYamlString(lines, "name", name)
  const withDescription = upsertYamlString(withName, "description", description)
  return ["---", ...withDescription, "---", "", body.replace(/^\n+/, "")].join("\n")
}

function parseSkillFrontmatter(content: string) {
  const parsed = splitSkillFrontmatter(content)
  if (!parsed) return
  return {
    name: yamlStringValue(parsed.frontmatter, "name"),
    description: yamlStringValue(parsed.frontmatter, "description"),
  }
}

function splitSkillFrontmatter(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) return
  return {
    frontmatter: match[1] ?? "",
    body: match[2] ?? "",
  }
}

function upsertYamlString(lines: string[], key: "name" | "description", value: string) {
  const next = [...lines]
  const index = next.findIndex((line) => new RegExp(`^\\s*${key}\\s*:`).test(line))
  const line = `${key}: ${JSON.stringify(value)}`
  if (index >= 0) return next.map((item, itemIndex) => itemIndex === index ? line : item)
  return [...next, line]
}

function yamlStringValue(frontmatter: string, key: "name" | "description") {
  const line = frontmatter.split("\n").find((item) => new RegExp(`^\\s*${key}\\s*:`).test(item))
  if (!line) return
  const value = line.slice(line.indexOf(":") + 1).trim()
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value.replace(/\s+#.*$/, "")
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

function inputClass() {
  return "h-8 min-w-0 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-2.5 text-[13px] text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
}

function secondaryButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-50"
}

function primaryButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--v2-text-text-base)] px-3 text-[12px] font-[530] text-[var(--v2-background-bg-base)] transition-opacity hover:opacity-90 disabled:opacity-50"
}

function modelSelection(value: string) {
  const [providerID, ...modelParts] = value.split("/")
  const modelID = modelParts.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
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
