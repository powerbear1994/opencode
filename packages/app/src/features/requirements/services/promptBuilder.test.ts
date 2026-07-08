import { describe, expect, test } from "bun:test"
import { buildDesignContent, buildDevelopmentContent, buildRawContent, buildTestContent } from "./promptBuilder"
import type { RequirementItem } from "../types"

const requirement: RequirementItem = {
  id: "REQ-001",
  projectId: "/repo",
  title: "实现导出",
  description: "增加导出能力",
  priority: "medium",
  status: "pending",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("promptBuilder", () => {
  test("asks requirement stage to preserve implementation hints without inventing design", () => {
    const prompt = buildRawContent(requirement)

    expect(prompt).toContain("实现线索")
    expect(prompt).toContain("不要自行探索代码或补充技术方案")
    expect(prompt).toContain("未提供")
  })

  test("requires design stage to produce verified code location handoff", () => {
    const prompt = buildDesignContent(requirement, "需求产物")

    expect(prompt).toContain("有限范围代码定位")
    expect(prompt).toContain("代码定位清单")
    expect(prompt).toContain("开发执行清单")
    expect(prompt).toContain("不要把未验证路径写成事实")
  })

  test("requires development implementation before writing the summary artifact", () => {
    const prompt = buildDevelopmentContent(requirement, "设计产物")

    expect(prompt).toContain("不要先生成开发摘要")
    expect(prompt.indexOf("完成必要代码修改")).toBeLessThan(prompt.indexOf("最后再将本次实现"))
    expect(prompt).toContain("docs/ai-workflow/REQ-001/03-development.md")
    expect(prompt).toContain("代码定位清单")
    expect(prompt).toContain("不要全项目大范围盲搜")
    expect(prompt).toContain("实际变更文件清单")
  })

  test("requires test stage to cover changed files and risks from development artifact", () => {
    const prompt = buildTestContent(requirement, "开发产物")

    expect(prompt).toContain("实际变更文件清单")
    expect(prompt).toContain("遗留风险")
    expect(prompt).toContain("开发产物缺陷")
  })
})
