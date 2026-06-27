import { describe, expect, test } from "bun:test"
import { filterSkills, skillCategory, skillDirectory, skillSource, type SkillInfo } from "./model"

const skills: SkillInfo[] = [
  {
    name: "global-release",
    description: "Create consistent releases",
    location: "/Users/robot/.claude/skills/global-release/SKILL.md",
    content: "",
  },
  {
    name: "project-review",
    description: "Review project changes",
    location: "/repo/.opencode/skill/project-review/SKILL.md",
    content: "",
  },
  {
    name: "builtin",
    location: "<built-in>",
    content: "",
  },
]

describe("skills model", () => {
  test("classifies project, global, and built-in sources", () => {
    expect(skillSource(skills[0], "/repo")).toBe("global")
    expect(skillSource(skills[1], "/repo")).toBe("project")
    expect(skillSource(skills[2], "/repo")).toBe("built-in")
  })

  test("filters by source and query", () => {
    expect(
      filterSkills({
        skills,
        query: "review",
        source: "project",
        directory: "/repo",
      }).map((skill) => skill.name),
    ).toEqual(["project-review"])
  })

  test("sorts project skills before global and built-in skills", () => {
    expect(
      filterSkills({
        skills,
        query: "",
        source: "all",
        directory: "/repo",
      }).map((skill) => skill.name),
    ).toEqual(["project-review", "global-release", "builtin"])
  })

  test("returns the owning directory for SKILL.md paths", () => {
    expect(skillDirectory(skills[1])).toBe("/repo/.opencode/skill/project-review")
  })

  test("classifies skill loading categories", () => {
    expect(skillCategory(skills[0], "/repo")).toBe("global-claude")
    expect(skillCategory(skills[1], "/repo")).toBe("project-opencode")
    expect(skillCategory(skills[2], "/repo")).toBe("built-in")
  })
})
