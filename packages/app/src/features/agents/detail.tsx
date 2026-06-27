import { For, Show, createSignal, createMemo, type Component } from "solid-js"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import type { Agent } from "@opencode-ai/sdk/v2/client"
import type { AgentSource } from "./types"
import { isBuiltinAgent, SOURCE_LABELS, MODE_LABELS, PERMISSION_ACTION_LABELS } from "./types"

// ── Props ──────────────────────────────────────────────────────────────────────

interface AgentDetailProps {
  agent: Agent | null
  source: AgentSource
  directory: string
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
}

// ── Card ───────────────────────────────────────────────────────────────────────

const Card: Component<{ title?: string; children: any }> = (props) => (
  <div class="overflow-hidden rounded-[7px] border border-[var(--v2-border-border-base)]">
    <Show when={props.title}>
      <div class="border-b border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-deep)] px-3.5 py-1.5">
        <h4 class="text-[10px] font-[530] text-[var(--v2-text-text-muted)] uppercase tracking-wider">{props.title}</h4>
      </div>
    </Show>
    <div class="px-3.5 py-2.5">{props.children}</div>
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
  <span class="shrink-0 rounded-[3px] bg-[var(--v2-blue-400)]/10 px-1.5 py-px text-[10px] font-[530] leading-snug text-[var(--v2-blue-500)]">
    {SOURCE_LABELS[props.source]}
  </span>
)

// ── Permission helpers ─────────────────────────────────────────────────────────

interface RawRule {
  action?: string
  resource?: string
  effect?: string
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

function splitRules(rules: RawRule[]): { core: RawRule[]; adv: RawRule[] } {
  const core: RawRule[] = []
  const adv: RawRule[] = []
  for (const r of rules) {
    if (CORE_KEYS.has(r.action ?? "")) core.push(r)
    else adv.push(r)
  }
  // Deduplicate core rules: keep only first occurrence per action
  const seen = new Set<string>()
  const deduped: RawRule[] = []
  for (const r of core) {
    if (!seen.has(r.action ?? "")) {
      seen.add(r.action ?? "")
      deduped.push(r)
    }
  }
  return { core: deduped, adv }
}

// ── Action badge ───────────────────────────────────────────────────────────────

const ActionBadge: Component<{ effect: string }> = (props) => (
  <span
    class="inline-block rounded-[4px] px-1.5 py-px text-[11px] font-[440]"
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

const secondaryButton = () =>
  "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:cursor-not-allowed disabled:opacity-60"

const dangerButton = () =>
  "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 text-[12px] font-[530] text-[var(--v2-red-600)] transition-colors hover:bg-[var(--v2-red-400)]/15 disabled:cursor-not-allowed disabled:opacity-60"

// ── Component ──────────────────────────────────────────────────────────────────

export const AgentDetail: Component<AgentDetailProps> = (props) => {
  const isBuiltin = () => isBuiltinAgent(props.agent?.name ?? "")
  const [showAdvanced, setShowAdvanced] = createSignal(false)

  const permData = createMemo(() => {
    const perms = props.agent?.permission
    if (!perms || perms.length === 0) return { core: [] as RawRule[], adv: [] as RawRule[] }
    return splitRules(perms as RawRule[])
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
              <p class="mt-1 truncate text-[12px] text-[var(--v2-text-text-muted)]">
                {MODE_LABELS[props.agent!.mode] ?? props.agent!.mode}
                <span class="mx-1 text-[var(--v2-text-text-faint)]">·</span>
                {props.agent!.model ? `${props.agent!.model.providerID}/${props.agent!.model.modelID}` : "默认模型"}
              </p>
            </div>
            <div class="flex shrink-0 items-center" style="gap: 1rem">
              <Show when={isBuiltin()}>
                <button type="button" class={secondaryButton()} onClick={props.onDuplicate}>复制为自定义</button>
              </Show>
              <Show when={!isBuiltin()}>
                <button type="button" class={secondaryButton()} onClick={props.onEdit}>编辑</button>
                <button type="button" class={dangerButton()} onClick={props.onDelete}>删除</button>
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
              <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">概览</h3>
              <div class="grid gap-3 lg:grid-cols-2">
                <Card title="运行设置">
                  <Row label="温度" value={props.agent!.temperature?.toString() ?? "默认"} />
                  <Row label="颜色" value={props.agent!.color ?? "默认"} />
                  <Row label="步骤" value={props.agent!.steps?.toString() ?? "默认"} />
                  <Show when={props.directory}>
                    <Row label="项目路径" value={props.directory} mono />
                  </Show>
                </Card>
                <Show when={props.agent!.description}>
                  <Card title="描述">
                    <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--v2-text-text-base)]">
                      {props.agent!.description}
                    </p>
                  </Card>
                </Show>
              </div>
            </section>

            <section>
              <h3 class="mb-2 text-[12px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">权限</h3>
              <Show when={isBuiltin()} fallback={
                <>
                  {/* Declared / effective permissions */}
                  <Card title="基础权限">
                    <Show when={permData().core.length > 0} fallback={
                      <p class="text-[13px] text-[var(--v2-text-text-muted)] py-2">未显式配置权限。</p>
                    }>
                      <table class="w-full text-[13px]">
                        <thead>
                          <tr class="border-b border-[var(--v2-border-border-base)] text-[var(--v2-text-text-muted)]">
                            <th class="text-left font-[440] py-1.5 pl-2 pr-4">权限项</th>
                            <th class="text-left font-[440] py-1.5 pr-2">策略</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={permData().core}>
                            {(rule) => (
                              <tr class="border-b border-[var(--v2-border-border-base)]/40 last:border-0">
                                <td class="py-1.5 pl-2 pr-4 font-mono text-[var(--v2-text-text-base)]">{rule.action}</td>
                                <td class="py-1.5 pr-2"><ActionBadge effect={rule.effect ?? "default"} /></td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
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
                        <span class="text-[11px]">{showAdvanced() ? "收起 ▲" : "展开 ▼"}</span>
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
                                      <td class="py-1 pl-2 pr-3 font-mono text-[var(--v2-text-text-base)]">{rule.action}</td>
                                      <td class="py-1 pr-2"><ActionBadge effect={rule.effect ?? "default"} /></td>
                                      <td
                                        class="max-w-[200px] truncate py-1 pr-2 font-mono text-[11px] text-[var(--v2-text-text-faint)]"
                                        title={rule.resource}
                                      >
                                        {rule.resource}
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
              <Card>
                <Show
                  when={props.agent!.prompt}
                  fallback={<p class="py-6 text-center text-[13px] text-[var(--v2-text-text-muted)]">此智能体无系统提示词。</p>}
                >
                  <div class="max-h-[520px] overflow-y-auto pr-2" style="scrollbar-gutter: stable">
                    <Markdown
                      text={props.agent!.prompt || " "}
                      cacheKey={`agent-prompt-preview:${props.agent!.name}:${props.agent!.prompt ?? ""}`}
                      class="text-[13px] leading-relaxed text-[var(--v2-text-text-base)]"
                    />
                  </div>
                </Show>
              </Card>
            </section>
          </div>
        </div>
      </Show>
    </div>
  )
}
