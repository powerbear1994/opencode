export type SkillInfo = {
  name: string
  description?: string
  location: string
  content: string
}

export type SkillSource = "built-in" | "project" | "global"
export type SkillSourceFilter = SkillSource | "all"
export type SkillCategory =
  | "built-in"
  | "project-opencode"
  | "project-claude"
  | "project-agents"
  | "global-claude"
  | "global-agents"
  | "custom"

export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  "built-in": "内置",
  project: "项目",
  global: "全局",
}

const SKILL_SOURCE_ORDER: Record<SkillSource, number> = {
  project: 0,
  global: 1,
  "built-in": 2,
}

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  "built-in": "内置技能",
  "project-opencode": "项目 .opencode",
  "project-claude": "项目 .claude",
  "project-agents": "项目 .agents",
  "global-claude": "全局 .claude",
  "global-agents": "全局 .agents",
  custom: "自定义路径",
}

export function skillSource(skill: Pick<SkillInfo, "location">, directory: string | undefined): SkillSource {
  if (skill.location === "<built-in>") return "built-in"
  if (directory && skill.location.startsWith(`${directory}/`)) return "project"
  return "global"
}

export function skillCategory(skill: Pick<SkillInfo, "location">, directory: string | undefined): SkillCategory {
  if (skill.location === "<built-in>") return "built-in"
  const normalized = skill.location.replaceAll("\\", "/")
  const project = directory ? normalized.startsWith(`${directory.replaceAll("\\", "/")}/`) : false
  if (project && normalized.includes("/.opencode/skill")) return "project-opencode"
  if (project && normalized.includes("/.claude/skills/")) return "project-claude"
  if (project && normalized.includes("/.agents/skills/")) return "project-agents"
  if (normalized.includes("/.claude/skills/")) return "global-claude"
  if (normalized.includes("/.agents/skills/")) return "global-agents"
  return "custom"
}

export function skillDirectory(skill: Pick<SkillInfo, "location">) {
  const marker = "/SKILL.md"
  if (!skill.location.endsWith(marker)) return skill.location
  return skill.location.slice(0, -marker.length)
}

export function filterSkills(input: {
  skills: readonly SkillInfo[]
  query: string
  source: SkillSourceFilter
  directory?: string
}) {
  const query = input.query.trim().toLowerCase()
  return input.skills
    .filter((skill) => {
      if (input.source === "all") return true
      return skillSource(skill, input.directory) === input.source
    })
    .filter((skill) => {
      if (!query) return true
      return [
        skill.name,
        skill.description ?? "",
        skill.location,
        skillDirectory(skill),
        SKILL_SOURCE_LABELS[skillSource(skill, input.directory)],
        SKILL_CATEGORY_LABELS[skillCategory(skill, input.directory)],
      ].some((value) => value.toLowerCase().includes(query))
    })
    .sort(
      (a, b) =>
        SKILL_SOURCE_ORDER[skillSource(a, input.directory)] - SKILL_SOURCE_ORDER[skillSource(b, input.directory)] ||
        a.name.localeCompare(b.name),
    )
}
