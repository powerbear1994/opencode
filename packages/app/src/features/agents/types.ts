import type { Agent } from "@opencode-ai/sdk/v2/client"

/** Where the agent comes from */
export type AgentSource = "built-in" | "project" | "global" | "project-config" | "global-config" | "unknown"

/** Agent save location */
export type AgentLocation = "project" | "global"

/** Permission action */
export type PermissionAction = "allow" | "ask" | "deny"

/** A single permission entry */
export interface PermissionEntry {
  tool: string
  action: PermissionAction
}

/** Form data for creating / editing an agent */
export interface AgentFormData {
  name: string
  location: AgentLocation
  mode: "subagent" | "primary" | "all"
  description: string
  model: string
  steps: number
  temperature: number
  color: string
  hidden: boolean
  disable: boolean
  permissions: PermissionEntry[]
  prompt: string
}

/** Agent with enriched source info for the UI */
export interface AgentWithSource extends Agent {
  source: AgentSource
}

/** Raw agent file content for editing */
export interface AgentFileContent {
  name: string
  path: string
  content: string
  frontmatter: Record<string, unknown>
  body: string
}

/** Available permission keys */
export const PERMISSION_KEYS = [
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
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

/** Default permission values */
export const DEFAULT_PERMISSIONS: Record<PermissionKey, PermissionAction> = {
  read: "allow",
  edit: "ask",
  bash: "ask",
  grep: "allow",
  glob: "allow",
  list: "allow",
  lsp: "ask",
  webfetch: "ask",
  websearch: "ask",
  skill: "ask",
  task: "ask",
}

/** Built-in agent names that cannot be edited/deleted */
export const BUILTIN_AGENT_NAMES = new Set([
  "build",
  "plan",
  "general",
  "explore",
  "scout",
  "compaction",
  "title",
  "summary",
  "requirement-agent",
  "design-agent",
  "development-agent",
  "testing-agent",
])

/** Check if an agent is built-in */
export function isBuiltinAgent(name: string): boolean {
  return BUILTIN_AGENT_NAMES.has(name)
}

// ── Display label mappings ─────────────────────────────────────────────────────

export const SOURCE_LABELS: Record<AgentSource, string> = {
  "built-in": "内置",
  project: "项目",
  global: "全局",
  "project-config": "项目配置",
  "global-config": "全局配置",
  unknown: "未知",
}

export const MODE_LABELS: Record<string, string> = {
  primary: "主智能体",
  subagent: "子智能体",
  all: "通用",
}

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  allow: "允许",
  ask: "询问",
  deny: "拒绝",
}

export const PERMISSION_TOOL_LABELS: Record<string, string> = {
  read: "读取",
  edit: "编辑",
  bash: "终端",
  grep: "搜索",
  glob: "匹配",
  list: "列表",
  lsp: "LSP",
  webfetch: "网页抓取",
  websearch: "网页搜索",
  skill: "技能",
  task: "任务",
}
