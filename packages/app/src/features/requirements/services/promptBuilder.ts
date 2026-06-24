import type { RequirementItem } from "../types"

/**
 * Build a lightweight raw-requirement content from the requirement fields.
 * Pure function — independent of any data source.
 */
export function buildRawContent(req: RequirementItem): string {
  return [
    "请基于当前项目处理以下原始需求：",
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
