import { createSimpleContext } from "@opencode-ai/ui/context"
import type { RequirementItem, RequirementProvider } from "./types"

export { buildDesignContent, buildDevelopmentContent, buildRawContent, buildTestContent } from "./services/promptBuilder"

// ── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_REQUIREMENTS: Omit<RequirementItem, "projectId" | "projectPath">[] = [
  {
    id: "REQ-001",
    title: "编写一个记账案例",
    status: "pending",
    priority: "high",
    description:
      "\n" +
      "## 需求描述\n" +
      "\n" +
      "请帮我开发一个现代风格的Web记账应用，包含如下功能：\n" +
      "\n" +
      "### 首页页面\n" +
      "\n" +
      "1. 大号数字显示本月支出/收入总额\n" +
      "\n" +
      "2. 醒目的“记一笔”按钮\n" +
      "\n" +
      "3. 最近记账记录列表（每条包含金额、分类图标、备注、时间）\n" +
      "\n" +
      "### 记账页面\n" +
      "\n" +
      "1. 记账表单页面包含计算器的数字键盘，金额输入时有数字键盘动画效果\n" +
      "\n" +
      "2. 记账支持常用分类选择（食品、交通、购物等，配以图标）、日期选择器、备注输入框，支持支出/收入切换标签\n" +
      "\n" +
      "3. 提交按钮带确认动画\n" +
      "\n" +
      "---\n" +
      "\n" +
      "## 技术要求\n" +
      "\n" +
      "### 前端\n" +
      "\n" +
      "1. 前端使用Vue2框架，UI框架使用Element UI 2.10.1\n" +
      "\n" +
      "2. 项目中所有依赖，需要在该项目的`package.json`中定义版本号。前端依赖需包括`vue`、`axios`、`vue-router`、`vuex`、`element-ui`、`@vue/cli-plugin-babel`、`@vue/cli-service`\n" +
      "\n" +
      "3. 创建前端工程，不使用命令`vue create`，直接创建文件\n" +
      "\n" +
      "4. 前端需生成访问后端逻辑，不能仅生成“// 这里应该调用后端API”这种注释方式的提示信息。前端访问后端时URL为`localhost:8080`\n" +
      "\n" +
      "5. 前端文件夹为`front`\n" +
      "\n" +
      "### 后端\n" +
      "\n" +
      "1. 使用Spring MVC分层模型，`spring-boot`版本为`2.3.2.RELEASE`；数据持久化框架使用MyBatis；JDK使用1.8；不使用lombok组件；使用`tomcat-jdbc`数据库连接池；引入`spring-boot-starter`组件；引入`logback-core`和`logback-classic`组件，版本号`1.2.13`\n" +
      "\n" +
      "2. 数据库使用H2，根据功能要求，设计表结构，给出建表语句，写入文档备用，注意同步提供主键、索引信息、列注释。建表语句参考：\n" +
      "\n" +
      "    ```SQL\n" +
      "    \n" +
      "    CREATE TABLE transactions(\n" +
      "    id INT PRIMARY KEY AUTO_INCREMENT, -- 主键\n" +
      "    amount DECIMAL(10,2) NOT NULL, -- 金额\n" +
      "    type INT NOT NULL, -- 收入或支出\n" +
      "    category INT NOT NULL, -- 分类,如食品、交通、购物等\n" +
      "    note TEXT, -- 备注\n" +
      "    transaction_date DATE NOT NULL, -- 交易日期\n" +
      "    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n" +
      "    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n" +
      "    );\n" +
      "    ```\n" +
      "\n" +
      "3. 后端需生成增、删、改、查等具体逻辑，生成SQL访问数据库，不能返回模拟数据。\n" +
      "\n" +
      "4. 后端文件夹为`back`\n" +
      "\n" +
      "---\n" +
      "\n" +
      "## 通用要求\n" +
      "\n" +
      "1. 页面文字使用中文，生成文件UTF-8编码\n",
    assignee: "张三",
    implementer: "李四",
    updatedAt: "2026-06-10T08:30:00Z",
  },
  {
    id: "REQ-002",
    title: "支持会话导出为 Markdown",
    status: "confirming",
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
    status: "confirming",
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
    status: "pending",
    priority: "low",
    description: "在会话中使用 Git 分支时，用户希望在会话头部直接看到当前所在分支，避免误提交到错误的分支上。",
    assignee: "张三",
    implementer: "李四",
    updatedAt: "2026-06-01T11:20:00Z",
  },
]

// ── Mock Provider ───────────────────────────────────────────────────────────

function requirementsForProject(projectId: string) {
  const seed = projectSeed(projectId)
  const count = 2 + (seed % (MOCK_REQUIREMENTS.length - 1))
  return MOCK_REQUIREMENTS.filter((_, index) => (index + seed) % 2 === 0)
    .concat(MOCK_REQUIREMENTS.filter((_, index) => (index + seed) % 2 !== 0))
    .slice(0, count)
    .map((requirement) => ({
      ...requirement,
      projectId,
      projectPath: projectId,
    }))
}

function projectSeed(projectId: string) {
  return Array.from(projectId).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function createMockProvider(): RequirementProvider {
  return {
    async listRequirements(projectId: string) {
      // Simulate network delay for realistic loading states
      await new Promise((r) => setTimeout(r, 400))
      if (!projectId) return []
      return requirementsForProject(projectId)
    },

    async getRequirementDetail(projectId: string, id: string) {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 200))
      if (!projectId) return undefined
      return requirementsForProject(projectId).find((r) => r.id === id)
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
