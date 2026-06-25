import type { RequirementItem } from "../types"

/**
 * Build a lightweight raw-requirement content from the requirement fields.
 * Pure function — independent of any data source.
 */
export function buildRawContent(req: RequirementItem): string {
  return [
    "请基于当前项目处理以下原始需求：",
    "",
    "输出要求：",
    `1. 将需求产物写入 docs/ai-workflow/${req.id}/01-requirement.md`,
    "2. 基于原始需求进行澄清、拆解和整理，生成结构化的需求产物",
    "3. 需求产物至少包含：用户故事、功能清单与优先级、验收标准、边界条件与异常场景、待澄清问题列表",
    "",
    `【需求编号】`,
    req.id,
    "",
    `【需求标题】`,
    req.title,
    "",
    `【需求描述】`,
    req.description,
  ].join("\n")
}

export function buildDesignContent(req: RequirementItem, requirementArtifact: string): string {
  return [
    "请基于以下已锁定的需求产物生成设计文档。",
    "",
    "输出要求：",
    `1. 将设计产物写入 docs/ai-workflow/${req.id}/02-design.md`,
    "2. 设计内容必须基于需求产物，不要回退到原始需求描述进行推断",
    "3. 至少包含设计目标、页面与交互、技术方案、数据与接口、验收要点",
    "",
    "【需求编号】",
    req.id,
    "",
    "【需求标题】",
    req.title,
    "",
    "【已锁定需求产物】",
    requirementArtifact,
  ].join("\n")
}

export function buildDevelopmentContent(req: RequirementItem, designArtifact: string): string {
  return [
    "请基于以下已锁定的设计产物完成开发实现。",
    "",
    "输出要求：",
    `1. 将开发产物写入 docs/ai-workflow/${req.id}/03-development.md`,
    "2. 开发实现必须基于设计产物，不要回退到原始需求或自行改变设计边界",
    "3. 开发产物至少包含：实现范围、关键文件变更、运行方式、验证结果、遗留风险",
    "4. 同步在当前项目中完成必要代码修改，并在产物中记录验证命令与结果",
    "",
    "【需求编号】",
    req.id,
    "",
    "【需求标题】",
    req.title,
    "",
    "【已锁定设计产物】",
    designArtifact,
  ].join("\n")
}

export function buildTestContent(req: RequirementItem, developmentArtifact: string): string {
  return [
    "请基于以下已锁定的开发产物完成测试验证。",
    "",
    "输出要求：",
    `1. 将测试产物写入 docs/ai-workflow/${req.id}/04-test.md`,
    "2. 测试验证必须基于开发产物，不要回退到原始需求或自行改变实现边界",
    "3. 测试产物至少包含：测试范围、测试用例、执行步骤、验证结果、缺陷与风险",
    "4. 在当前项目中执行必要验证，并在产物中记录验证命令与结果",
    "",
    "【需求编号】",
    req.id,
    "",
    "【需求标题】",
    req.title,
    "",
    "【已锁定开发产物】",
    developmentArtifact,
  ].join("\n")
}
