import { For, Show, createEffect, createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Dialog } from "@opencode-ai/ui/v2/dialog-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useModels } from "@/context/models"
import type { AgentFormData, AgentLocation, PermissionAction } from "./types"
import { BUILTIN_AGENT_NAMES, DEFAULT_PERMISSIONS, PERMISSION_KEYS, type PermissionKey } from "./types"
import "./editor.css"

interface AgentEditorProps {
  title: string
  initialData?: Partial<AgentFormData>
  hideLocation?: boolean
  nameLocked?: boolean
  loading?: boolean
  projectDir?: string
  hasProject?: boolean
  createAsSubagent?: boolean
  variant?: "dialog" | "inline"
  onSave: (data: AgentFormData) => void
  onCancel?: () => void
}

function defaultFormData(
  overrides?: Partial<AgentFormData>,
  hasProject = true,
  createAsSubagent = false,
): AgentFormData {
  const permissions = PERMISSION_KEYS.map((tool) => ({ tool, action: DEFAULT_PERMISSIONS[tool] }))
  const form = { ...overrides }
  return {
    name: form.name ?? "",
    ...form,
    location: form.location ?? (hasProject ? "project" : "global"),
    mode: form.mode ?? (createAsSubagent ? "subagent" : "all"),
    description: form.description ?? "",
    model: form.model ?? "",
    temperature: form.temperature ?? 0,
    color: form.color ?? "",
    hidden: form.hidden ?? false,
    disable: form.disable ?? false,
    permissions: form.permissions ?? permissions,
    prompt: form.prompt ?? "",
    ...(createAsSubagent ? { mode: "subagent" as const } : {}),
  }
}

const ACTION_OPTIONS: { value: PermissionAction; label: string }[] = [
  { value: "allow", label: "允许" },
  { value: "ask", label: "询问" },
  { value: "deny", label: "拒绝" },
]

const LOCATION_OPTIONS = [
  { value: "project", label: "当前项目", description: "仅在当前项目中使用" },
  { value: "global", label: "全局", description: "可在所有项目中使用" },
]

type ModelOption = {
  value: string
  label: string
  provider: string
}

const PermissionRow: Component<{
  tool: PermissionKey
  action: PermissionAction
  onChange: (action: PermissionAction) => void
}> = (props) => (
  <div class="agent-editor-permission-row">
    <span class="font-mono text-[13px] text-text-base">{props.tool}</span>
    <div class="agent-editor-permission-control" role="group" aria-label={`${props.tool} 权限`}>
      <For each={ACTION_OPTIONS}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.action === option.value}
            data-selected={props.action === option.value ? "" : undefined}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  </div>
)

export const AgentEditor: Component<AgentEditorProps> = (props) => {
  const dialog = useDialog()
  const models = useModels()
  const [state, setState] = createStore({
    form: defaultFormData(props.initialData, props.hasProject, props.createAsSubagent),
    advancedOpen: false,
    modelSelectKey: 0,
  })

  createEffect(() => setState("form", defaultFormData(props.initialData, props.hasProject, props.createAsSubagent)))

  const update = (next: Partial<AgentFormData>) => setState("form", (form) => ({ ...form, ...next }))
  const formPermissions = () => state.form.permissions ?? []
  const permission = (tool: PermissionKey) =>
    formPermissions().find((item) => item.tool === tool)?.action ?? DEFAULT_PERMISSIONS[tool]
  const setPermission = (tool: PermissionKey, action: PermissionAction) => {
    const index = formPermissions().findIndex((item) => item.tool === tool)
    if (index >= 0) {
      setState("form", "permissions", index, "action", action)
      return
    }
    setState("form", "permissions", formPermissions().length, { tool, action })
  }
  const modelOptions = createMemo(() => {
    const available = models
      .list()
      .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id }))
      .map((model) => ({
        value: `${model.provider.id}/${model.id}`,
        label: model.name,
        provider: model.provider.name,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label))
    if (!state.form.model || available.some((option) => option.value === state.form.model)) {
      return available
    }
    return [
      {
        value: state.form.model,
        label: state.form.model,
        provider: "当前配置",
      },
      ...available,
    ]
  })
  const selectedModel = createMemo(() => modelOptions().find((option) => option.value === state.form.model))
  const selectedLocation = createMemo(
    () => LOCATION_OPTIONS.find((option) => option.value === state.form.location) ?? LOCATION_OPTIONS[1]!,
  )
  const locationPath = createMemo(() =>
    state.form.location === "project" && props.projectDir
      ? `${props.projectDir}/.opencode/agents`
      : "~/.config/opencode/agents",
  )
  const permissionsAreDefault = createMemo(() =>
    PERMISSION_KEYS.every((tool) => permission(tool) === DEFAULT_PERMISSIONS[tool]),
  )
  const resetPermissions = () =>
    setState(
      "form",
      "permissions",
      PERMISSION_KEYS.map((tool) => ({ tool, action: DEFAULT_PERMISSIONS[tool] })),
    )
  const resetModel = () => {
    update({ model: "" })
    setState("modelSelectKey", (key) => key + 1)
  }
  const normalizedName = createMemo(() => (state.form.name ?? "").trim().toLowerCase())
  const nameError = createMemo(() => {
    if (!(state.form.name ?? "").trim()) return ""
    if (!/^[a-z0-9._-]+$/.test(normalizedName())) return "仅支持字母、数字、点、下划线和连字符。"
    if (BUILTIN_AGENT_NAMES.has(normalizedName())) return "该名称为内置智能体保留名称。"
    return ""
  })
  const valid = createMemo(() => !!normalizedName() && !nameError() && !!(state.form.description ?? "").trim())

  const handleSave = () => {
    if (!valid()) return
    props.onSave(state.form)
  }

  const content = () => (
    <div class="agent-editor-shell" data-variant={props.variant ?? "dialog"}>
        <div class="agent-editor-body">
          <section class="mb-5">
            <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">
              基本信息
            </h3>
            <div class="agent-editor-form-grid">
              <div class="agent-editor-field-span">
                <div class="agent-editor-required-label">
                  <span>{props.nameLocked ? "名称（不可修改）" : "名称"}</span>
                  <Show when={!props.nameLocked}>
                    <span aria-hidden="true">*</span>
                  </Show>
                </div>
                <TextField
                  autofocus={!props.nameLocked}
                  hideLabel
                  label="名称"
                  value={state.form.name}
                  onChange={(name) => update({ name })}
                  placeholder="my-agent"
                  disabled={props.nameLocked}
                  required
                  error={nameError()}
                  description={props.nameLocked ? undefined : "用于生成智能体文件名，保存后不可修改。"}
                />
              </div>

              <Show when={!props.hideLocation}>
                <div class="agent-editor-field-span">
                  <label class="text-12-medium text-text-weak">保存位置</label>
                  <div class="agent-editor-location">
                    <div class="agent-editor-location-copy">
                      <p>{selectedLocation().description}</p>
                      <code title={locationPath()}>{locationPath()}</code>
                      <Show when={props.createAsSubagent}>
                        <span>将创建为专项智能体，可由主智能体在需要时调用。</span>
                      </Show>
                    </div>
                    <SelectV2
                      appearance="inline"
                      options={LOCATION_OPTIONS.filter((option) => option.value !== "project" || props.hasProject)}
                      current={selectedLocation()}
                      value={(option) => option.value}
                      label={(option) => option.label}
                      onSelect={(option) => option && update({ location: option.value as AgentLocation })}
                      class="agent-editor-location-select"
                      placement="bottom-end"
                    />
                  </div>
                </div>
                <Show when={!props.hasProject}>
                  <p class="agent-editor-location-help agent-editor-field-span">
                    当前未打开项目，因此仅可保存为全局智能体。
                  </p>
                </Show>
              </Show>

              <div class="agent-editor-field-span">
                <div class="agent-editor-required-label">
                  <span>描述</span>
                  <span aria-hidden="true">*</span>
                </div>
                <TextField
                  hideLabel
                  label="描述"
                  value={state.form.description}
                  onChange={(description) => update({ description })}
                  placeholder="这个智能体负责什么？"
                  required
                />
              </div>

              <div class="agent-editor-field-span">
                <div class="agent-editor-model-label">
                  <label class="text-12-medium text-text-weak">模型（选填）</label>
                  <Show when={state.form.model}>
                    <button type="button" onClick={resetModel}>
                      恢复默认
                    </button>
                  </Show>
                </div>
                <For each={[state.modelSelectKey]}>
                  {() => (
                    <SelectV2
                      appearance="base"
                      placeholder="使用默认模型"
                      options={modelOptions()}
                      current={selectedModel()}
                      value={(option) => option.value}
                      label={(option) => `${option.provider} / ${option.label}`}
                      groupBy={(option) => option.provider}
                      onSelect={(option) => option && update({ model: option.value })}
                      class="agent-editor-model-select"
                    />
                  )}
                </For>
              </div>

              <div class="agent-editor-field-span">
                <p class="text-12-medium text-text-weak">状态设置</p>
                <div class="agent-editor-status-list">
                  <div class="agent-editor-status-row">
                    <div>
                      <p>在列表中隐藏</p>
                      <span>开启后，该智能体不会显示在常用智能体列表中，但仍保留配置。</span>
                    </div>
                    <Switch
                      checked={state.form.hidden}
                      onChange={(hidden) => update({ hidden })}
                      aria-label="在列表中隐藏"
                    />
                  </div>
                  <div class="agent-editor-status-row">
                    <div>
                      <p>禁用智能体</p>
                      <span>开启后，该智能体不会被调用。</span>
                    </div>
                    <Switch
                      checked={state.form.disable}
                      onChange={(disable) => update({ disable })}
                      aria-label="禁用智能体"
                    />
                  </div>
                </div>
              </div>

              <div class="agent-editor-advanced agent-editor-field-span">
                <button
                  type="button"
                  aria-expanded={state.advancedOpen}
                  onClick={() => setState("advancedOpen", (open) => !open)}
                >
                  <span>高级设置</span>
                  <span aria-hidden="true">{state.advancedOpen ? "−" : "+"}</span>
                </button>
                <Show when={state.advancedOpen}>
                  <div class="agent-editor-advanced-fields">
                    <TextField
                      label="温度（选填）"
                      value={state.form.temperature === 0 ? "" : String(state.form.temperature)}
                      onChange={(value) => {
                        const temperature = Number.parseFloat(value)
                        update({ temperature: Number.isNaN(temperature) ? 0 : temperature })
                      }}
                      placeholder="使用默认值"
                    />
                    <TextField
                      label="颜色（选填）"
                      value={state.form.color}
                      onChange={(color) => update({ color })}
                      placeholder="使用默认值"
                    />
                  </div>
                </Show>
              </div>
            </div>
          </section>

          <section class="mb-5">
            <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">
              权限
            </h3>
            <div class="flex flex-col gap-4">
              <div class="agent-editor-permission-header">
                <p>配置智能体可使用的工具权限。未显式设置的权限将使用默认值。</p>
                <button type="button" disabled={permissionsAreDefault()} onClick={resetPermissions}>
                  重置为默认
                </button>
              </div>
              <div class="agent-editor-permission-list">
                <For each={PERMISSION_KEYS}>
                  {(tool) => (
                    <PermissionRow
                      tool={tool}
                      action={permission(tool)}
                      onChange={(action) => setPermission(tool, action)}
                    />
                  )}
                </For>
              </div>
            </div>
          </section>

          <section class="mb-5">
            <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">
              系统提示词
            </h3>
            <div class="flex flex-col gap-3">
              <MarkdownEditorPreview
                value={state.form.prompt}
                preview={state.form.prompt}
                cacheKey={`agent-editor-prompt-preview:${state.form.name}:${state.form.prompt}`}
                onInput={(prompt) => update({ prompt })}
              />
            </div>
          </section>
        </div>

        <div class="agent-editor-footer">
          <p>保存后需重新打开项目或重启桌面端后生效。</p>
          <div class="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="small" onClick={() => props.onCancel?.() ?? dialog.close()} disabled={props.loading}>
              取消
            </Button>
            <Button variant="primary" size="small" onClick={handleSave} disabled={props.loading || !valid()}>
              {props.loading ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </div>
  )

  if (props.variant === "inline") {
    return (
      <div class="flex h-full min-w-0 flex-1 flex-col">
        <div class="shrink-0 border-b border-[var(--v2-border-border-base)] px-6 py-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="truncate text-[18px] font-[530] text-[var(--v2-text-text-base)]">{props.title}</h2>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleSave}
                disabled={props.loading || !valid()}
                class="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {props.loading ? "保存中..." : props.nameLocked ? "保存" : "创建"}
              </button>
              <button
                type="button"
                onClick={() => props.onCancel?.()}
                disabled={props.loading}
                class="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                取消
              </button>
            </div>
          </div>
        </div>
        {content()}
      </div>
    )
  }

  return (
    <Dialog title={props.title} size="large" class="agent-editor-dialog">
      {content()}
    </Dialog>
  )
}

function MarkdownEditorPreview(props: {
  value: string
  preview: string
  cacheKey: string
  onInput: (value: string) => void
}) {
  const [split, setSplit] = createStore({ value: 50 })
  let containerRef: HTMLDivElement | undefined
  let editorRef: HTMLTextAreaElement | undefined
  let previewRef: HTMLDivElement | undefined
  let syncing = false

  const onEditorScroll = () => {
    if (syncing || !editorRef || !previewRef) return
    syncing = true
    const max = editorRef.scrollHeight - editorRef.clientHeight
    if (max <= 0) {
      syncing = false
      return
    }
    previewRef.scrollTop = (editorRef.scrollTop / max) * (previewRef.scrollHeight - previewRef.clientHeight)
    requestAnimationFrame(() => {
      syncing = false
    })
  }

  const onPreviewScroll = () => {
    if (syncing || !editorRef || !previewRef) return
    syncing = true
    const max = previewRef.scrollHeight - previewRef.clientHeight
    if (max <= 0) {
      syncing = false
      return
    }
    editorRef.scrollTop = (previewRef.scrollTop / max) * (editorRef.scrollHeight - editorRef.clientHeight)
    requestAnimationFrame(() => {
      syncing = false
    })
  }

  const onDividerDown = (e: MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      if (!containerRef) return
      const rect = containerRef.getBoundingClientRect()
      setSplit("value", Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100)))
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
      class="flex h-[calc(100vh-370px)] min-h-[320px] overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]"
    >
      <textarea
        ref={editorRef}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onScroll={onEditorScroll}
        spellcheck={false}
        style={{ width: `${split.value}%` }}
        class="min-h-0 resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
        placeholder="你是一个..."
      />
      <div class="flex shrink-0 cursor-col-resize items-center justify-center py-2" onMouseDown={onDividerDown}>
        <div class="h-full w-px bg-[var(--v2-border-border-base)]" />
      </div>
      <div
        ref={previewRef}
        onScroll={onPreviewScroll}
        style={{ width: `${100 - split.value}%` }}
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
