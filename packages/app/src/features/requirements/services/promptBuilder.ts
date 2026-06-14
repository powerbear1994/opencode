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

/**
 * Generate an OpenCode implementation prompt from a requirement.
 * Pure function — independent of any data source.
 */
export function generatePrompt(req: RequirementItem): string {
  return [
    `## Requirement: ${req.id} — ${req.title}`,
    ``,
    `**Priority:** ${req.priority}`,
    ``,
    `### Description`,
    req.description,
    ``,
    `### Execution Method`,
    ``,
    `1. **Analyze the project structure** — Examine the current codebase to understand relevant modules, pages, APIs, interfaces, and data models.`,
    `2. **Identify affected areas** — Determine which directories, files, modules, pages, interfaces, or data models are impacted by this requirement.`,
    `3. **Present a brief plan** — Before writing any code, outline the implementation approach for review.`,
    `4. **Implement following existing patterns** — Write code that matches the surrounding style, conventions, and architecture.`,
    `5. **Document the changes** — Summarize modified files, core logic, and verification steps.`,
    ``,
    `### Constraints`,
    ``,
    `- **Preserve existing code style** — Match naming, formatting, and architectural patterns in the codebase.`,
    `- **No unrelated refactoring** — Do not make large-scale changes that are outside the scope of this requirement.`,
    `- **Ask if uncertain** — If any information is missing or ambiguous, ask clarifying questions before proceeding. Do not make assumptions.`,
    `- **Respect existing abstractions** — Do not bypass or rewrite existing context providers, hooks, or utilities unless absolutely necessary.`,
    ``,
    `### Output Requirements`,
    ``,
    `- **Modified files** — List every modified file with a brief description of the change.`,
    `- **Core logic** — Describe the key implementation logic and design decisions.`,
    `- **Verification** — Provide step-by-step instructions to verify the changes work correctly.`,
    `- **Trade-offs** — Note any design trade-offs or areas for future improvement.`,
  ].join("\n")
}
