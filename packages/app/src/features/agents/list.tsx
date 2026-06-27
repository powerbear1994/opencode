import { For, Show, createMemo, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { Agent } from "@opencode-ai/sdk/v2/client"
import type { AgentSource } from "./types"
import { isBuiltinAgent, SOURCE_LABELS, MODE_LABELS } from "./types"

// ── Filter tab ─────────────────────────────────────────────────────────────────

const FilterTab: Component<{ active: boolean; disabled?: boolean; onClick: () => void; children: any }> = (props) => (
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

// ── Props ──────────────────────────────────────────────────────────────────────

interface AgentListProps {
  agents: Agent[]
  sources: Map<string, AgentSource>
  counts: Record<AgentSource | "all", number>
  selectedId: string | null
  loading: boolean
  error: string | null
  search: string
  sourceFilter: AgentSource | "all"
  hasProject: boolean
  onSearchChange: (value: string) => void
  onSourceFilterChange: (value: AgentSource | "all") => void
  onSelect: (id: string) => void
  onRefresh: () => void
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

const SourceBadge: Component<{ source: AgentSource }> = (props) => (
  <span class="shrink-0 px-1.5 py-px rounded-[3px] text-[10px] font-[530] leading-snug text-[var(--v2-blue-500)] bg-[var(--v2-blue-400)]/10">
    {SOURCE_LABELS[props.source]}
  </span>
)

const ModeBadge: Component<{ mode: string }> = (props) => (
  <span class="shrink-0 px-1.5 py-px rounded-[3px] text-[10px] font-[530] leading-snug text-[var(--v2-text-text-muted)] bg-[var(--v2-background-bg-layer-02)]">
    {MODE_LABELS[props.mode] ?? props.mode}
  </span>
)

const SOURCE_ORDER: Record<AgentSource, number> = {
  project: 0,
  global: 1,
  "built-in": 2,
}

// ── Component ──────────────────────────────────────────────────────────────────

export const AgentList: Component<AgentListProps> = (props) => {
  const filtered = createMemo(() => {
    let list = props.agents
    // Source filter
    if (props.sourceFilter !== "all") {
      list = list.filter((a) => {
        const src = getSource(a.name)
        return src === props.sourceFilter
      })
    }
    // Search filter
    const q = props.search.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.description && a.description.toLowerCase().includes(q)),
      )
    }
    return list
      .slice()
      .sort(
        (a, b) =>
          SOURCE_ORDER[getSource(a.name)] - SOURCE_ORDER[getSource(b.name)] ||
          a.name.localeCompare(b.name),
      )
  })

  const getSource = (name: string): AgentSource => {
    if (isBuiltinAgent(name)) return "built-in"
    return props.sources.get(name) ?? "project"
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      {/* ── Toolbar: search + new ── */}
      <div class="shrink-0 px-4 pb-2 pt-3">
        <div class="flex items-center gap-1.5">
          <div class="relative flex h-8 flex-1 items-center">
            <span class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--v2-text-text-faint)]">
              <Icon name="magnifying-glass" size="small" class="size-3.5" />
            </span>
            <input
              type="search"
              value={props.search}
              onInput={(e) => props.onSearchChange(e.currentTarget.value)}
              placeholder="搜索名称或描述..."
              class="h-8 w-full rounded-[6px] border border-transparent bg-[var(--v2-background-bg-layer-01)] pl-8 pr-3 text-[13px] leading-8 text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)]"
            />
          </div>
          <Tooltip value="刷新列表" placement="bottom">
            <IconButton icon="arrow-undo-down" variant="ghost" size="small" onClick={props.onRefresh} />
          </Tooltip>
        </div>

        {/* Source filter tabs */}
        <div class="mt-2 flex items-center gap-0.5 overflow-x-auto">
          <FilterTab
            active={props.sourceFilter === "all"}
            onClick={() => props.onSourceFilterChange("all")}
          >
            全部 {props.counts.all}
          </FilterTab>
          <FilterTab
            active={props.sourceFilter === "project"}
            disabled={!props.hasProject}
            onClick={() => props.onSourceFilterChange("project")}
          >
            项目 {props.counts.project}
          </FilterTab>
          <FilterTab
            active={props.sourceFilter === "global"}
            onClick={() => props.onSourceFilterChange("global")}
          >
            全局 {props.counts.global}
          </FilterTab>
          <FilterTab
            active={props.sourceFilter === "built-in"}
            onClick={() => props.onSourceFilterChange("built-in")}
          >
            内置 {props.counts["built-in"]}
          </FilterTab>
        </div>
      </div>

      {/* ── Content ── */}
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {/* Loading */}
        <Show when={props.loading && filtered().length === 0}>
          <div class="flex flex-col gap-1 py-1">
            <For each={[1, 2, 3, 4]}>
              {() => <div class="h-[74px] animate-pulse rounded-[8px] bg-[var(--v2-background-bg-layer-01)]" />}
            </For>
          </div>
        </Show>

        {/* Error */}
        <Show when={props.error && !props.loading}>
          <div class="flex flex-col items-center gap-3 py-8">
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">{props.error}</p>
            <button
              type="button"
              onClick={props.onRefresh}
              class="px-3 py-1.5 rounded-[6px] text-[13px] bg-[var(--v2-background-bg-layer-01)] text-[var(--v2-text-text-base)] hover:bg-[var(--v2-background-bg-layer-02)] transition-colors"
            >
              重试
            </button>
          </div>
        </Show>

        {/* Empty */}
        <Show when={!props.loading && !props.error && filtered().length === 0}>
          <div class="flex flex-col items-center gap-2 py-12 text-center">
            <Icon name="models" size="large" class="text-[var(--v2-text-text-faint)]" />
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">没有匹配的智能体</p>
          </div>
        </Show>

        {/* List */}
        <Show when={!props.error && filtered().length > 0}>
          <div class="flex flex-col gap-1">
            <For each={filtered()}>
              {(agent) => {
                const source = () => getSource(agent.name)
                const isSelected = () => agent.name === props.selectedId
                return (
                  <button
                    type="button"
                    class="group relative w-full rounded-[7px] border px-3 py-2 text-left transition-colors"
                    classList={{
                      "bg-transparent border-transparent hover:bg-[var(--v2-background-bg-layer-01)] hover:border-[var(--v2-border-border-base)]":
                        !isSelected(),
                      "bg-[var(--v2-background-bg-layer-01)] border-[var(--v2-border-border-base)]":
                        isSelected(),
                    }}
                    onClick={() => props.onSelect(agent.name)}
                  >
                    {/* Selected indicator */}
                    <Show when={isSelected()}>
                      <div class="absolute left-0 top-[4px] bottom-[4px] w-[2.5px] bg-[var(--v2-blue-400)] rounded-r-[2px]" />
                    </Show>

                    {/* Row 1: name + source */}
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="text-[13px] font-[530] text-[var(--v2-text-text-base)] truncate">
                        {agent.name}
                      </span>
                      <SourceBadge source={source()} />
                      <Show when={agent.hidden}>
                        <span class="text-[10px] text-[var(--v2-text-text-faint)] shrink-0">隐藏</span>
                      </Show>
                    </div>

                    {/* Row 3: description (max 2 lines) */}
                    <p class="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--v2-text-text-muted)]">
                      {agent.description || "没有描述"}
                    </p>
                    <div class="mt-1 flex min-w-0 items-center gap-1.5">
                      <ModeBadge mode={agent.mode} />
                      <span class="min-w-0 truncate text-[10px] text-[var(--v2-text-text-faint)]">
                        {agent.model ? `${agent.model.providerID}/${agent.model.modelID}` : "默认模型"}
                      </span>
                    </div>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
