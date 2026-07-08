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
    "4. 额外输出“实现线索”小节：只记录原始输入中由用户或程序员提供的页面、模块、类、方法、接口、表、配置、相似功能、搜索关键词、禁止改动区域；不要自行探索代码或补充技术方案",
    "5. 如果原始输入未提供实现线索，写“未提供”；如果线索来自推断，必须标记为“需求推断/低置信度”",
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
    "4. 必须先用需求产物中的“实现线索”做有限范围代码定位；不得全项目无目标盲搜",
    "5. 必须输出“代码定位清单”：候选路径/类/方法/接口/表/配置、用途、来源、是否已验证、置信度",
    "6. 必须输出“开发执行清单”：允许修改的文件/模块、参考文件、推荐搜索关键词、禁止改动区域、建议验证命令",
    "7. 如果无法定位到关键代码，必须在设计产物中列为阻塞问题，不要把未验证路径写成事实",
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
    "执行顺序：",
    "1. 先阅读设计产物中的“代码定位清单”和“开发执行清单”，按清单做有限范围检查，不要先生成开发摘要。",
    "2. 完成必要代码修改后，运行可行的验证命令。",
    "3. 最后再将本次实现、验证结果和遗留风险汇总为开发产物。",
    "",
    "输出要求：",
    `1. 将开发产物写入 docs/ai-workflow/${req.id}/03-development.md`,
    "2. 开发实现必须基于设计产物，不要回退到原始需求或自行改变设计边界",
    "3. 开发产物至少包含：实现范围、关键文件变更、运行方式、验证结果、遗留风险",
    "4. 同步在当前项目中完成必要代码修改，并在产物中记录验证命令与结果",
    "5. 开发产物必须包含“实际变更文件清单”，逐项说明修改原因；如果设计定位清单缺失、错误或无法验证，必须先提问或记录阻塞，不要全项目大范围盲搜",
    "6. 仅当定位清单不足时，才允许使用推荐搜索关键词做补充搜索，并在开发产物中说明新增定位依据",
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
    "5. 测试产物必须逐项覆盖开发产物中的“实际变更文件清单”和“遗留风险”；未覆盖的项必须说明原因",
    "6. 如果开发产物缺少实际变更文件或验证命令，必须标记为开发产物缺陷并要求补充",
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
