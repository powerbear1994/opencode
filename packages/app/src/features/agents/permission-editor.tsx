import { For, type Component } from "solid-js"
import type { PermissionAction, PermissionEntry, PermissionKey } from "./types"
import { PERMISSION_KEYS, DEFAULT_PERMISSIONS, PERMISSION_TOOL_LABELS } from "./types"

// ── Props ──────────────────────────────────────────────────────────────────────

interface PermissionEditorProps {
  permissions: PermissionEntry[]
  onChange: (permissions: PermissionEntry[]) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export const PermissionEditor: Component<PermissionEditorProps> = (props) => {
  const getAction = (tool: string): PermissionAction => {
    const entry = props.permissions.find((p) => p.tool === tool)
    return entry?.action ?? DEFAULT_PERMISSIONS[tool as PermissionKey] ?? "ask"
  }

  const setAction = (tool: string, action: PermissionAction) => {
    const next = props.permissions.filter((p) => p.tool !== tool)
    next.push({ tool, action })
    props.onChange(next)
  }

  const actions: PermissionAction[] = ["allow", "ask", "deny"]
  const actionLabels: Record<PermissionAction, string> = {
    allow: "允许",
    ask: "询问",
    deny: "拒绝",
  }

  return (
    <div class="flex flex-col gap-1">
      {/* Header */}
      <div class="flex items-center gap-2 px-1 pb-1">
        <span class="flex-[2] text-[11px] font-[530] text-text-muted uppercase tracking-wider">
          工具
        </span>
        <div class="flex-[3] flex">
          <For each={actions}>
            {(action) => (
              <span class="flex-1 text-center text-[11px] font-[530] text-text-muted uppercase tracking-wider">
                {actionLabels[action]}
              </span>
            )}
          </For>
        </div>
      </div>

      {/* Rows */}
      <div class="flex flex-col gap-px max-h-[320px] overflow-y-auto">
        <For each={PERMISSION_KEYS}>
          {(tool) => {
            const current = () => getAction(tool)
            const label = PERMISSION_TOOL_LABELS[tool] ?? tool
            return (
              <div class="flex items-center gap-2 px-1 py-0.5 rounded-[4px] hover:bg-bg-layer-01">
                <span class="flex-[2] text-[12px] text-text-base font-mono leading-snug">
                  {tool}
                </span>
                <div class="flex-[3] flex">
                  <For each={actions}>
                    {(action) => (
                      <button
                        type="button"
                        onClick={() => setAction(tool, action)}
                        class="flex-1 h-[24px] rounded-[4px] text-[11px] font-[530] border transition-colors mx-px"
                        classList={{
                          "bg-green-400/15 text-green-500 border-green-400/30":
                            current() === action && action === "allow",
                          "bg-amber-400/15 text-amber-500 border-amber-400/30":
                            current() === action && action === "ask",
                          "bg-red-400/15 text-red-500 border-red-400/30":
                            current() === action && action === "deny",
                          "text-text-muted border-transparent hover:border-divider-light":
                            current() !== action,
                        }}
                      >
                        {current() === action ? "●" : "○"}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
