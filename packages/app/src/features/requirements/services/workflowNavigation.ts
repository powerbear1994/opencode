import type { RequirementSendMode } from "../types"

export type WorkflowArtifact = "raw" | "requirement" | "design" | "development" | "test"
export type WorkflowPhase = "requirement" | "design" | "development" | "test"

export function workflowLabel(sourceMode: RequirementSendMode | undefined) {
  if (sourceMode === "test") return "测试"
  if (sourceMode === "development") return "开发"
  if (sourceMode === "design") return "设计"
  return "需求"
}

export function workflowSessionTitle(sourceMode: RequirementSendMode | undefined) {
  return `${workflowLabel(sourceMode)}智能体会话`
}

export function workflowArtifact(sourceMode: RequirementSendMode | undefined): WorkflowArtifact {
  if (sourceMode === "test") return "test"
  if (sourceMode === "development") return "development"
  if (sourceMode === "design") return "design"
  return "requirement"
}

export function workflowArtifactFromQuery(value: string | undefined): WorkflowArtifact | undefined {
  if (value === "raw" || value === "requirement" || value === "design" || value === "development" || value === "test") return value
  return undefined
}

export function workflowPhaseForArtifact(artifact: WorkflowArtifact): WorkflowPhase {
  if (artifact === "test") return "test"
  if (artifact === "development") return "development"
  if (artifact === "design") return "design"
  return "requirement"
}

export function workbenchRequirementHref(input: {
  project: string
  requirementId: string
  artifact?: WorkflowArtifact
}) {
  const artifact = input.artifact ? `&artifact=${encodeURIComponent(input.artifact)}` : ""
  return `/workbench?project=${encodeURIComponent(input.project)}&selectedId=${encodeURIComponent(input.requirementId)}${artifact}`
}
