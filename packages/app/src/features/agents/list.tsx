import { For, Show, createMemo, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { Agent } from "@opencode-ai/sdk/v2/client"
import type { AgentSource } from "./types"
import { isBuiltinAgent, SOURCE_LABELS, MODE_LABELS } from "./types"

// ── Filter tab ─────────────────────────────────────────────────────────────────

const FilterTab: Component<{ active: boolean; onClick: () => void; children: any }> = (props) => (
  <button
    type="button"
    onClick={props.onClick}
    class="px-2.5 py-1 rounded-[5px] text-[11px] font-[440] transition-colors"
    classList={{
      "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-base)]": props.active,
      "text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)] hover:bg-[var(--v2-background-bg-layer-01)]": !props.active,
    }}
  >
    {props.children}
  </button>
)

// ── Props ──────────────────────────────────────────────────────────────────────

interface AgentListProps {
  agents: Agent[]
  sources: Map<string, AgentSource>
  selectedId: string | null
  loading: boolean
  error: string | null
  search: string
  sourceFilter: AgentSource | "all"
  onSearchChange: (value: string) => void
  onSourceFilterChange: (value: AgentSource | "all") => void
  onSelect: (id: string) => void
  onNew: () => void
  onRefresh: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
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
  })

  const getSource = (name: string): AgentSource => {
    if (isBuiltinAgent(name)) return "built-in"
    return props.sources.get(name) ?? "project"
  }

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* ── Toolbar: search + new ── */}
      <div class="shrink-0 px-4 pt-3 pb-1">
        <div class="flex items-center gap-1.5">
          <div class="relative flex-1">
            <Icon
              name="magnifying-glass"
              size="small"
              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--v2-text-text-faint)]"
            />
            <input
              type="text"
              value={props.search}
              onInput={(e) => props.onSearchChange(e.currentTarget.value)}
              placeholder="搜索智能体..."
              class="w-full h-8 pl-8 pr-3 rounded-[6px] bg-[var(--v2-background-bg-layer-01)] text-[13px] text-[var(--v2-text-text-base)] placeholder:text-[var(--v2-text-text-faint)] outline-none border border-transparent focus:border-[var(--v2-blue-400)] transition-colors"
            />
          </div>
          <Tooltip value="刷新列表" placement="bottom">
            <IconButton icon="arrow-undo-down" variant="ghost" size="small" onClick={props.onRefresh} />
          </Tooltip>
          <button
            type="button"
            onClick={props.onNew}
            class="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-[6px] text-[12px] font-[440] text-[var(--v2-text-text-muted)] hover:text-[var(--v2-text-text-base)] hover:bg-[var(--v2-background-bg-layer-01)] active:bg-[var(--v2-background-bg-deep)] transition-colors"
          >
            <Icon name="plus-small" size="small" />
            新建
          </button>
        </div>

        {/* Source filter tabs */}
        <div class="flex items-center gap-0.5 mt-1.5">
          <FilterTab
            active={props.sourceFilter === "all"}
            onClick={() => props.onSourceFilterChange("all")}
          >
            全部
          </FilterTab>
          <FilterTab
            active={props.sourceFilter === "built-in"}
            onClick={() => props.onSourceFilterChange("built-in")}
          >
            内置
          </FilterTab>
          <FilterTab
            active={props.sourceFilter === "project"}
            onClick={() => props.onSourceFilterChange("project")}
          >
            项目
          </FilterTab>
          <FilterTab
            active={props.sourceFilter === "global"}
            onClick={() => props.onSourceFilterChange("global")}
          >
            全局
          </FilterTab>
        </div>
      </div>

      {/* ── Content ── */}
      <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {/* Loading */}
        <Show when={props.loading && filtered().length === 0}>
          <div class="flex flex-col gap-1.5 py-1">
            <For each={[1, 2, 3, 4]}>
              {() => <div class="h-[52px] rounded-[8px] bg-[var(--v2-background-bg-layer-01)] animate-pulse" />}
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
          <div class="flex flex-col items-center gap-2 py-12">
            <Icon name="bubble-5" size="large" class="text-[var(--v2-text-text-faint)]" />
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">暂无智能体</p>
          </div>
        </Show>

        {/* List */}
        <Show when={!props.error && filtered().length > 0}>
          <div class="flex flex-col gap-1">
            <For each={filtered()}>
              {(agent) => {
                const source = () => getSource(agent.name)
                const isSelected = () => agent.name === props.selectedId
                const isBuiltin = () => isBuiltinAgent(agent.name)

                return (
                  <div
                    class="w-full text-left px-3 py-2 transition-colors cursor-pointer rounded-[7px] relative group border"
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
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-[13px] font-[530] text-[var(--v2-text-text-base)] truncate">
                        {agent.name}
                      </span>
                      <SourceBadge source={source()} />
                      <Show when={agent.hidden}>
                        <span class="text-[10px] text-[var(--v2-text-text-faint)] shrink-0">隐藏</span>
                      </Show>
                    </div>

                    {/* Row 2: mode */}
                    <div class="flex items-center gap-1.5 mt-1">
                      <ModeBadge mode={agent.mode} />
                    </div>

                    {/* Row 3: description (max 2 lines) */}
                    <Show when={agent.description}>
                      <p class="text-[11px] text-[var(--v2-text-text-muted)] leading-snug mt-1 line-clamp-2">
                        {agent.description}
                      </p>
                    </Show>

                    {/* Hover actions */}
                    <div class="absolute right-2 top-2 hidden group-hover:flex items-center gap-0.5 bg-[var(--v2-background-bg-layer-01)] rounded-[6px] px-0.5">
                      <Show when={isBuiltin()}>
                        <Tooltip value="复制为自定义智能体" placement="top">
                          <IconButton
                            icon="open-file"
                            variant="ghost"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onDuplicate(agent.name)
                            }}
                          />
                        </Tooltip>
                      </Show>
                      <Show when={!isBuiltin()}>
                        <Tooltip value="编辑" placement="top">
                          <IconButton
                            icon="pencil-line"
                            variant="ghost"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onEdit(agent.name)
                            }}
                          />
                        </Tooltip>
                        <Tooltip value="删除" placement="top">
                          <IconButton
                            icon="circle-x"
                            variant="ghost"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onDelete(agent.name)
                            }}
                          />
                        </Tooltip>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
