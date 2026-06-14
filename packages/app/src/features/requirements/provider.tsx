import { createSimpleContext } from "@opencode-ai/ui/context"
import type { RequirementItem, RequirementProvider } from "./types"

// Re-export prompt builder for backward compatibility
export { generatePrompt, buildRawContent } from "./services/promptBuilder"

// ── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_REQUIREMENTS: RequirementItem[] = [
  {
    id: "REQ-001",
    title: "设置面板增加深色模式切换",
    status: "todo",
    priority: "high",
    description:
      "用户希望在设置面板中增加手动切换深色/浅色模式的开关。目前应用仅跟随系统主题，添加手动切换后用户可覆盖系统偏好，独立选择自己喜爱的主题。",
    assignee: "张三",
    implementer: "李四",
    updatedAt: "2026-06-10T08:30:00Z",
  },
  {
    id: "REQ-002",
    title: "支持会话导出为 Markdown",
    status: "doing",
    priority: "medium",
    description:
      "用户希望将会话内容（消息、代码变更、终端输出）导出为 Markdown 文件，便于文档归档、团队分享以及保留 AI 辅助开发的个人记录。",
    assignee: "王五",
    implementer: "赵六",
    updatedAt: "2026-06-11T14:00:00Z",
  },
  {
    id: "REQ-003",
    title: "增加快速文件搜索快捷键",
    status: "done",
    priority: "high",
    description:
      "高级用户需要类似 VS Code Ctrl+P 的快速文件搜索功能，支持模糊匹配并在当前项目中快速切换文件，搜索结果优先展示最近打开的文件。",
    assignee: "孙七",
    implementer: "周八",
    updatedAt: "2026-06-05T09:00:00Z",
  },
  {
    id: "REQ-004",
    title: "实现 MCP 工具权限自动批准规则",
    status: "waiting_review",
    priority: "medium",
    description:
      "频繁使用 MCP 工具的用户希望能够为特定工具或工具模式创建自动批准规则，减少每次调用工具都需要手动批准的繁琐操作，同时保持安全边界。",
    assignee: "吴九",
    implementer: "郑十",
    updatedAt: "2026-06-08T16:45:00Z",
  },
  {
    id: "REQ-005",
    title: "增加会话分支指示器",
    status: "failed",
    priority: "low",
    description:
      "在会话中使用 Git 分支时，用户希望在会话头部直接看到当前所在分支，避免误提交到错误的分支上。",
    assignee: "张三",
    implementer: "李四",
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
