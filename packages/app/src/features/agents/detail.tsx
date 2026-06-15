import { For, Show, createSignal, createMemo, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
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

const Card: Component<{ title: string; children: any }> = (props) => (
  <div class="rounded-[7px] border border-[var(--v2-border-border-base)] overflow-hidden">
    <div class="px-3.5 py-1.5 bg-[var(--v2-background-bg-deep)] border-b border-[var(--v2-border-border-base)]">
      <h4 class="text-[10px] font-[530] text-[var(--v2-text-text-muted)] uppercase tracking-wider">{props.title}</h4>
    </div>
    <div class="px-3.5 py-2.5">{props.children}</div>
  </div>
)

const Row: Component<{ label: string; value?: string | null; mono?: boolean }> = (props) => (
  <div class="flex items-center justify-between gap-3 py-0.5">
    <span class="text-[12px] text-[var(--v2-text-text-muted)] shrink-0">{props.label}</span>
    <span class="text-[12px] text-[var(--v2-text-text-base)] text-right truncate" classList={{ "font-mono text-[11px]": props.mono }}>
      {props.value || "—"}
    </span>
  </div>
)

// ── Tab button ─────────────────────────────────────────────────────────────────

const TabBtn: Component<{ active: boolean; onClick: () => void; children: any }> = (props) => (
  <button type="button" onClick={props.onClick}
    class="px-3 py-1.5 text-[12px] font-[440] border-b-2 transition-colors"
    classList={{
      "text-[var(--v2-text-text-base)] border-[var(--v2-blue-400)]": props.active,
      "text-[var(--v2-text-text-muted)] border-transparent hover:text-[var(--v2-text-text-base)]": !props.active,
    }}
  >{props.children}</button>
)

// ── Permission helpers ─────────────────────────────────────────────────────────

interface RawRule { action?: string; resource?: string; effect?: string }
const CORE_KEYS = new Set(["read","edit","bash","grep","glob","list","lsp","webfetch","websearch","skill","task"])

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
  <span class="inline-block px-1.5 py-px rounded-[4px] text-[11px] font-[440]"
    classList={{
      "text-[var(--v2-green-600)] bg-[var(--v2-green-400)]/10": props.effect === "allow",
      "text-[var(--v2-amber-600)] bg-[var(--v2-amber-400)]/10": props.effect === "ask",
      "text-[var(--v2-red-600)] bg-[var(--v2-red-400)]/10": props.effect === "deny",
      "text-[var(--v2-text-text-muted)] bg-[var(--v2-background-bg-deep)]": !["allow","ask","deny"].includes(props.effect),
    }}
  >
    {PERMISSION_ACTION_LABELS[props.effect as keyof typeof PERMISSION_ACTION_LABELS] ?? props.effect}
  </span>
)

// ── Component ──────────────────────────────────────────────────────────────────

export const AgentDetail: Component<AgentDetailProps> = (props) => {
  const isBuiltin = () => isBuiltinAgent(props.agent?.name ?? "")
  const [tab, setTab] = createSignal<"overview" | "permissions" | "prompt">("overview")
  const [showAdvanced, setShowAdvanced] = createSignal(false)

  const permData = createMemo(() => {
    const perms = props.agent?.permission
    if (!perms || perms.length === 0) return { core: [] as RawRule[], adv: [] as RawRule[] }
    return splitRules(perms as RawRule[])
  })

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div class="shrink-0 flex items-center gap-1 px-5 pt-3 border-b border-[var(--v2-border-border-base)]">
        <TabBtn active={tab() === "overview"} onClick={() => setTab("overview")}>概览</TabBtn>
        <TabBtn active={tab() === "permissions"} onClick={() => setTab("permissions")}>权限</TabBtn>
        <TabBtn active={tab() === "prompt"} onClick={() => setTab("prompt")}>系统提示词</TabBtn>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <Show when={props.agent} fallback={
          <div class="flex items-center justify-center py-16 text-[13px] text-[var(--v2-text-text-muted)]">
            选择一个智能体查看详情
          </div>
        }>
          {/* ── Header ── */}
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="flex flex-col gap-1 min-w-0">
              <h2 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">{props.agent!.name}</h2>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[12px] text-[var(--v2-text-text-muted)]">
                  {SOURCE_LABELS[props.source]} · {MODE_LABELS[props.agent!.mode] ?? props.agent!.mode}
                </span>
                <Show when={props.agent!.hidden}>
                  <span class="text-[10px] px-1.5 py-px rounded-[3px] bg-[var(--v2-amber-400)]/10 text-[var(--v2-amber-500)]">隐藏</span>
                </Show>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Show when={isBuiltin()}>
                <Button variant="ghost" size="small" icon="open-file" onClick={props.onDuplicate}>复制为自定义</Button>
              </Show>
              <Show when={!isBuiltin()}>
                <Button variant="ghost" size="small" icon="pencil-line" onClick={props.onEdit}>编辑</Button>
                <Button variant="ghost" size="small" icon="circle-x" onClick={props.onDelete}>删除</Button>
              </Show>
            </div>
          </div>

          <Show when={isBuiltin()}>
            <div class="text-[12px] text-[var(--v2-text-text-muted)] px-3 py-2 rounded-[6px] bg-[var(--v2-background-bg-layer-01)] border border-[var(--v2-border-border-base)] mb-4">
              内置智能体不可直接编辑，可使用「复制为自定义」创建副本后进行自定义。
            </div>
          </Show>

          {/* ── Tab: 概览 ── */}
          <Show when={tab() === "overview"}>
            <div class="flex flex-col gap-3">
              <Card title="基本信息">
                <Row label="名称" value={props.agent!.name} />
                <Row label="来源" value={SOURCE_LABELS[props.source]} />
                <Row label="类型" value={MODE_LABELS[props.agent!.mode] ?? props.agent!.mode} />
                <Show when={props.directory}>
                  <Row label="项目路径" value={props.directory} mono />
                </Show>
              </Card>

              <Card title="配置">
                <Row label="模型" value={props.agent!.model ? `${props.agent!.model.providerID}/${props.agent!.model.modelID}` : "默认"} mono />
                <Row label="温度" value={props.agent!.temperature?.toString() ?? "默认"} />
                <Row label="颜色" value={props.agent!.color ?? "默认"} />
                <Row label="是否隐藏" value={props.agent!.hidden ? "是" : "否"} />
                <Row label="步骤" value={props.agent!.steps?.toString() ?? "默认"} />
              </Card>

              <Show when={props.agent!.description}>
                <Card title="描述">
                  <p class="text-[13px] text-[var(--v2-text-text-base)] leading-relaxed whitespace-pre-wrap">{props.agent!.description}</p>
                </Card>
              </Show>

            </div>
          </Show>

          {/* ── Tab: 权限 ── */}
          <Show when={tab() === "permissions"}>
            <div class="flex flex-col gap-3">
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
                                      <td class="py-1 pr-2 font-mono text-[var(--v2-text-text-faint)] text-[11px] truncate max-w-[200px]" title={rule.resource}>{rule.resource}</td>
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
            </div>
          </Show>

          {/* ── Tab: 系统提示词 ── */}
          <Show when={tab() === "prompt"}>
            <Show when={props.agent!.prompt} fallback={
              <p class="text-[13px] text-[var(--v2-text-text-muted)] py-8 text-center">此智能体无系统提示词。</p>
            }>
              <Card title="系统提示词">
                <div class="max-h-[400px] overflow-y-auto" style="scrollbar-gutter: stable">
                  <pre class="text-[12px] whitespace-pre-wrap leading-relaxed font-mono text-[var(--v2-text-text-base)] pr-5">{props.agent!.prompt}</pre>
                </div>
              </Card>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
