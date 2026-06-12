import { createSimpleContext } from "@opencode-ai/ui/context"
import type { RequirementItem, RequirementProvider } from "./types"

// Re-export prompt builder for backward compatibility
export { generatePrompt, buildRawContent } from "./services/promptBuilder"

// ── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_REQUIREMENTS: RequirementItem[] = [
  {
    id: "REQ-001",
    title: "Add Dark Mode Toggle to Settings",
    status: "todo",
    priority: "high",
    source: "OpenCode Community",
    module: "settings",
    description:
      "Users have requested a manual dark/light mode toggle in the settings panel. Currently the app only follows the system theme. Adding a manual toggle would allow users to override the system preference and choose their preferred theme independently.",
    acceptanceCriteria: [
      "Settings panel shows a theme selector with System/Light/Dark options",
      "Selecting a theme immediately applies it without page reload",
      "Theme preference persists across app restarts",
      "Default setting follows system theme",
    ],
    tags: ["ui", "theme", "settings"],
    updatedAt: "2026-06-10T08:30:00Z",
  },
  {
    id: "REQ-002",
    title: "Support Session Export as Markdown",
    status: "doing",
    priority: "medium",
    source: "GitHub Issues #2847",
    module: "session",
    description:
      "Users want to export their entire session (messages, code changes, terminal output) as a Markdown file. This is useful for documentation, sharing with teammates, and keeping a personal record of AI-assisted development sessions.",
    acceptanceCriteria: [
      "Export button available in session header or context menu",
      "Exported Markdown includes all user and assistant messages",
      "Code blocks are properly formatted with language hints",
      "Terminal output is included as fenced code blocks",
      "File path and session metadata are included in the header",
    ],
    tags: ["export", "markdown", "session"],
    updatedAt: "2026-06-11T14:00:00Z",
  },
  {
    id: "REQ-003",
    title: "Add Keyboard Shortcut for Quick File Search",
    status: "done",
    priority: "high",
    source: "Internal Planning",
    module: "file-tree",
    description:
      "Power users need a quick file search (similar to VS Code's Ctrl+P) to rapidly navigate between files in the current project. The search should support fuzzy matching and show recently opened files first.",
    acceptanceCriteria: [
      "Press Ctrl+P / Cmd+P to open file search palette",
      "Fuzzy search across all project files",
      "Recently opened files appear at top of results",
      "Enter or click opens the file in the editor",
      "Search is responsive even in large projects (10k+ files)",
    ],
    tags: ["keyboard", "search", "file-tree", "ux"],
    updatedAt: "2026-06-05T09:00:00Z",
  },
  {
    id: "REQ-004",
    title: "Implement MCP Tool Permission Auto-Approve Rules",
    status: "todo",
    priority: "medium",
    source: "OpenCode Discord",
    module: "permissions",
    description:
      "Users frequently using MCP tools want the ability to create auto-approve rules for specific tools or tool patterns. This reduces the friction of having to approve every tool call while maintaining security boundaries.",
    acceptanceCriteria: [
      "Settings panel has a new 'MCP Permissions' section",
      "Users can create rules by tool name (exact match or glob pattern)",
      "Each rule can be scoped to specific servers",
      "Rules can be toggled on/off individually",
      "Auto-approved tools still show a subtle indicator in the session",
    ],
    tags: ["mcp", "permissions", "ux"],
    updatedAt: "2026-06-08T16:45:00Z",
  },
  {
    id: "REQ-005",
    title: "Add Session Branch Indicator",
    status: "todo",
    priority: "low",
    source: "GitHub Issues #3012",
    module: "session",
    description:
      "When working with git branches in a session, users want to see which branch they are on directly in the session header. This helps avoid accidentally committing to the wrong branch.",
    acceptanceCriteria: [
      "Session header shows current git branch name",
      "Branch indicator updates when branch changes",
      "Clicking indicator shows recent branch history",
      "Indicator is hidden when not in a git repository",
    ],
    tags: ["git", "session", "ux"],
    updatedAt: "2026-06-01T11:20:00Z",
  },
]

// ── Mock Provider ───────────────────────────────────────────────────────────

function createMockProvider(): RequirementProvider {
  return {
    async listRequirements() {
      // Simulate network delay for realistic loading states
      await new Promise((r) => setTimeout(r, 400))
      return [...MOCK_REQUIREMENTS]
    },

    async getRequirementDetail(id: string) {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 200))
      return MOCK_REQUIREMENTS.find((r) => r.id === id)
    },
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

export const {
  provider: RequirementsProvider,
  use: useRequirements,
} = createSimpleContext<RequirementProvider, Record<string, any>>({
  name: "Requirements",
  init: () => createMockProvider(),
  gate: false,
})
