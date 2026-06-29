import { For, Show, createSignal, createMemo, type Component } from "solid-js"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import type { Agent } from "@opencode-ai/sdk/v2/client"
import type { AgentSource } from "./types"
import {
  DEFAULT_PERMISSIONS,
  isBuiltinAgent,
  MODE_LABELS,
  PERMISSION_ACTION_LABELS,
  PERMISSION_KEYS,
  PERMISSION_TOOL_LABELS,
  SOURCE_LABELS,
  type PermissionAction,
  type PermissionKey,
} from "./types"

// ── Props ──────────────────────────────────────────────────────────────────────

interface AgentDetailProps {
  agent: Agent | null
  source: AgentSource
  directory: string
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onCopyPath: () => Promise<void>
}

// ── Card ───────────────────────────────────────────────────────────────────────

const Card: Component<{ title?: string; children: any }> = (props) => (
  <div class="overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]">
    <Show when={props.title}>
      <div class="border-b border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] px-3.5 py-1.5">
        <h4 class="text-[10px] font-[530] text-[var(--v2-text-text-muted)] uppercase tracking-wider">{props.title}</h4>
      </div>
    </Show>
    <div class="px-3.5 py-3">{props.children}</div>
  </div>
)

const Row: Component<{ label: string; value?: string | null; mono?: boolean }> = (props) => (
  <div class="flex items-center justify-between gap-3 py-0.5">
    <span class="text-[12px] text-[var(--v2-text-text-muted)] shrink-0">{props.label}</span>
    <span
      class="truncate text-right text-[12px] text-[var(--v2-text-text-base)]"
      classList={{ "font-mono text-[11px]": props.mono }}
    >
      {props.value || "—"}
    </span>
  </div>
)

const SourceBadge: Component<{ source: AgentSource }> = (props) => (
  <span
    class="shrink-0 rounded-[3px] px-1.5 py-px text-[10px] font-[530] leading-snug"
    classList={{
      "bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-500)]": props.source === "project",
      "bg-[var(--v2-green-400)]/10 text-[var(--v2-green-600)]": props.source === "global",
      "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-muted)]": props.source === "built-in",
    }}
  >
    {SOURCE_LABELS[props.source]}
  </span>
)

const MetadataItem: Component<{ label: string; value?: string | null; mono?: boolean }> = (props) => (
  <div class="min-w-0 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] px-3 py-2">
    <p class="text-[10px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-faint)]">{props.label}</p>
    <p
      class="mt-1 truncate text-[12px] text-[var(--v2-text-text-base)]"
      classList={{ "font-mono text-[11px]": props.mono }}
      title={props.value ?? undefined}
    >
      {props.value || "默认"}
    </p>
  </div>
)

// ── Permission helpers ─────────────────────────────────────────────────────────

interface RawRule {
  action?: string
  resource?: string
  effect?: string
  permission?: string
  pattern?: string
}
const CORE_KEYS = new Set([
  "read",
  "edit",
  "bash",
  "grep",
  "glob",
  "list",
  "lsp",
  "webfetch",
  "websearch",
  "skill",
  "task",
])

function permissionEffect(value: string | undefined): PermissionAction | undefined {
  if (value === "allow" || value === "ask" || value === "deny") return value
}

function rulePermission(rule: RawRule) {
  if (rule.permission) return rule.permission
  if (rule.effect) return rule.action
}

function ruleEffect(rule: RawRule) {
  return permissionEffect(rule.effect ?? rule.action)
}

function rulePattern(rule: RawRule) {
  return rule.pattern ?? rule.resource ?? "*"
}

function matchingRule(rule: RawRule, tool: PermissionKey) {
  const permission = rulePermission(rule)
  return (permission === tool || permission === "*") && rulePattern(rule) === "*" && !!ruleEffect(rule)
}

function configuredPermissions(rules: RawRule[]) {
  return PERMISSION_KEYS.map((tool) => {
    const rule = rules.findLast((item) => matchingRule(item, tool))
    return {
      tool,
      effect: ruleEffect(rule ?? {}) ?? DEFAULT_PERMISSIONS[tool],
    }
  })
}

function advancedRules(rules: RawRule[]) {
  return rules.filter((rule) => {
    const permission = rulePermission(rule)
    if (!permission) return true
    if (permission === "*") return false
    if (!CORE_KEYS.has(permission)) return true
    return rulePattern(rule) !== "*"
  })
}

// ── Action badge ───────────────────────────────────────────────────────────────

const ActionBadge: Component<{ effect: string }> = (props) => (
  <span
    class="inline-flex h-5 items-center rounded-[4px] px-1.5 text-[11px] font-[530]"
    classList={{
      "text-[var(--v2-green-600)] bg-[var(--v2-green-400)]/10": props.effect === "allow",
      "text-[var(--v2-amber-600)] bg-[var(--v2-amber-400)]/10": props.effect === "ask",
      "text-[var(--v2-red-600)] bg-[var(--v2-red-400)]/10": props.effect === "deny",
      "text-[var(--v2-text-text-muted)] bg-[var(--v2-background-bg-deep)]": !["allow", "ask", "deny"].includes(props.effect),
    }}
  >
    {PERMISSION_ACTION_LABELS[props.effect as keyof typeof PERMISSION_ACTION_LABELS] ?? props.effect}
  </span>
)

const PermissionChip: Component<{ item: { tool: PermissionKey; effect: PermissionAction } }> = (props) => (
  <div class="flex min-w-0 items-center justify-between gap-3 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] px-3 py-2">
    <div class="min-w-0">
      <p class="truncate font-mono text-[12px] text-[var(--v2-text-text-base)]">{props.item.tool}</p>
      <p class="mt-0.5 truncate text-[10px] text-[var(--v2-text-text-faint)]">
        {PERMISSION_TOOL_LABELS[props.item.tool]}
      </p>
    </div>
    <ActionBadge effect={props.item.effect} />
  </div>
)

const secondaryButton = () =>
  "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"

const mutedDangerButton = () =>
  secondaryButton() + " hover:border-[var(--v2-red-400)]/40 hover:bg-[var(--v2-red-400)]/10 hover:text-[var(--v2-red-600)]"

// ── Component ──────────────────────────────────────────────────────────────────

export const AgentDetail: Component<AgentDetailProps> = (props) => {
  const isBuiltin = () => isBuiltinAgent(props.agent?.name ?? "")
  const [showAdvanced, setShowAdvanced] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const copyPath = async () => {
    if (isBuiltin()) return
    try {
      await props.onCopyPath()
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Error toast is handled by the parent.
    }
  }

  const permData = createMemo(() => {
    const perms = props.agent?.permission
    if (!perms || perms.length === 0) return { configured: configuredPermissions([]), adv: [] as RawRule[] }
    const rules = perms as RawRule[]
    return {
      configured: configuredPermissions(rules),
      adv: advancedRules(rules),
    }
  })

  return (
    <div class="flex h-full min-w-0 flex-1 flex-col">
      <Show
        when={props.agent}
        fallback={
          <div class="flex flex-1 items-center justify-center text-[13px] text-[var(--v2-text-text-muted)]">
            选择一个智能体查看详情
          </div>
        }
      >
        <div class="shrink-0 border-b border-[var(--v2-border-border-base)] px-6 py-4">
          {/* ── Header ── */}
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <h2 class="truncate text-[18px] font-[530] text-[var(--v2-text-text-base)]">{props.agent!.name}</h2>
                <SourceBadge source={props.source} />
                <Show when={props.agent!.hidden}>
                  <span class="shrink-0 rounded-[3px] bg-[var(--v2-amber-400)]/10 px-1.5 py-px text-[10px] text-[var(--v2-amber-500)]">隐藏</span>
                </Show>
              </div>
              <p class="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--v2-text-text-muted)]">
                {props.agent!.description || "没有描述"}
              </p>
              <Show when={props.directory}>
                <p class="mt-1 truncate font-mono text-[10px] text-[var(--v2-text-text-faint)]" title={props.directory}>
                  {props.directory}
                </p>
              </Show>
              <p class="mt-1 truncate font-mono text-[10px] text-[var(--v2-text-text-faint)]">
                {MODE_LABELS[props.agent!.mode] ?? props.agent!.mode}
                <span class="mx-1 font-sans text-[var(--v2-text-text-faint)]">·</span>
                {props.agent!.model ? `${props.agent!.model.providerID}/${props.agent!.model.modelID}` : "默认模型"}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2.5">
              <Show when={isBuiltin()}>
                <button type="button" class={secondaryButton()} onClick={props.onDuplicate}>复制为自定义</button>
              </Show>
              <Show when={!isBuiltin()}>
                <button type="button" class={secondaryButton()} onClick={copyPath}>
                  {copied() ? "已复制" : "复制路径"}
                </button>
                <button type="button" class={secondaryButton()} onClick={props.onEdit}>编辑</button>
                <button type="button" class={mutedDangerButton()} onClick={props.onDelete}>删除</button>
              </Show>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <Show when={isBuiltin()}>
            <div class="mb-4 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 py-2 text-[12px] text-[var(--v2-text-text-muted)]">
              内置智能体不可直接编辑，可使用「复制为自定义」创建副本后进行自定义。
            </div>
          </Show>

          <div class="flex flex-col gap-5">
            <section>
              <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">元数据</h3>
              <Card>
                <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  <MetadataItem label="步骤" value={props.agent!.steps?.toString() ?? "默认"} />
                  <MetadataItem label="温度" value={props.agent!.temperature?.toString() ?? "默认"} />
                  <MetadataItem label="颜色" value={props.agent!.color ?? "默认"} />
                </div>
              </Card>
            </section>

            <section>
              <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">权限</h3>
              <Show when={isBuiltin()} fallback={
                <>
                  {/* Declared / effective permissions */}
                  <Card title="配置权限">
                    <Show when={permData().configured.length > 0} fallback={
                      <p class="text-[13px] text-[var(--v2-text-text-muted)] py-2">未显式配置权限。</p>
                    }>
                      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        <For each={permData().configured}>
                          {(item) => <PermissionChip item={item} />}
                        </For>
                      </div>
                    </Show>
                  </Card>

                  {/* Advanced: runtime rules, collapsed */}
                  <Show when={permData().adv.length > 0}>
                    <div class="rounded-[7px] border border-[var(--v2-border-border-base)] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        class="w-full flex items-center justify-between px-3.5 py-1.5 bg-[var(--v2-background-bg-deep)] border-b border-[var(--v2-border-border-base)] text-[10px] font-[530] text-[var(--v2-text-text-muted)] uppercase tracking-wider hover:text-[var(--v2-text-text-base)] transition-colors"
                      >
                        <span>高级规则 · OpenCode 内部生效规则</span>
                        <span class="text-[11px]">{showAdvanced() ? "收起" : "展开"}</span>
                      </button>
                      <Show when={showAdvanced()}>
                        <div class="px-3.5 py-2">
                          <p class="text-[11px] text-[var(--v2-text-text-faint)] mb-2">
                            以下规则由 OpenCode 运行时自动合并，通常无需关注。
                          </p>
                          <div class="max-h-[180px] overflow-y-auto pr-1">
                            <table class="w-full text-[12px]">
                              <thead class="sticky top-0 bg-[var(--v2-background-bg-layer-01)]">
                                <tr class="border-b border-[var(--v2-border-border-base)]/40 text-[var(--v2-text-text-muted)]">
                                  <th class="text-left font-[440] py-1 pl-2 pr-3">规则</th>
                                  <th class="text-left font-[440] py-1 pr-2">动作</th>
                                  <th class="text-left font-[440] py-1 pr-2">范围</th>
                                </tr>
                              </thead>
                              <tbody>
                                <For each={permData().adv}>
                                  {(rule) => (
                                    <tr class="border-b border-[var(--v2-border-border-base)]/30 last:border-0">
                                      <td class="py-1 pl-2 pr-3 font-mono text-[var(--v2-text-text-base)]">{rulePermission(rule)}</td>
                                      <td class="py-1 pr-2"><ActionBadge effect={ruleEffect(rule) ?? "default"} /></td>
                                      <td
                                        class="max-w-[200px] truncate py-1 pr-2 font-mono text-[11px] text-[var(--v2-text-text-faint)]"
                                        title={rulePattern(rule)}
                                      >
                                        {rulePattern(rule)}
                                      </td>
                                    </tr>
                                  )}
                                </For>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </>
              }>
                {/* Built-in agent: preset policy notice */}
                <Card title="权限策略">
                  <div class="flex flex-col gap-2">
                    <p class="text-[13px] text-[var(--v2-text-text-muted)]">
                      内置智能体使用 OpenCode 预设权限策略，不支持直接编辑。
                    </p>
                    <div class="text-[12px] text-[var(--v2-text-text-base)]">
                      <Row label="类型" value="内置权限策略" />
                      <Row label="是否可编辑" value="否" />
                      <Row label="自定义方式" value="复制为自定义智能体" />
                    </div>
                  </div>
                </Card>
              </Show>
            </section>

            <section>
              <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">系统提示词</h3>
              <div class="min-h-[320px] overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)]">
                <div class="flex h-8 items-center justify-between border-b border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-base)] px-4">
                  <span class="text-[11px] font-[530] text-[var(--v2-text-text-muted)]">预览</span>
                  <span class="rounded-[3px] bg-[var(--v2-background-bg-layer-02)] px-1.5 py-px text-[10px] font-[530] text-[var(--v2-text-text-muted)]">
                    Markdown
                  </span>
                </div>
                <Show
                  when={props.agent!.prompt}
                  fallback={<p class="py-6 text-center text-[13px] text-[var(--v2-text-text-muted)]">此智能体无系统提示词。</p>}
                >
                  <div class="h-[calc(100vh-482px)] min-h-[288px] overflow-y-auto p-4">
                    <Markdown
                      text={props.agent!.prompt || " "}
                      cacheKey={`agent-prompt-preview:${props.agent!.name}:${props.agent!.prompt ?? ""}`}
                      class="text-[13px] leading-relaxed text-[var(--v2-text-text-base)]"
                    />
                  </div>
                </Show>
              </div>
            </section>
          </div>
        </div>
      </Show>
    </div>
  )
}
