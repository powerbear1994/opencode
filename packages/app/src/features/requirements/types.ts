/** A single requirement item matching the RequirementItem data model */
export interface RequirementItem {
  id: string
  title: string
  status: "todo" | "doing" | "done"
  priority: "high" | "medium" | "low"
  source: string
  description: string
  acceptanceCriteria: string[]
  module?: string
  tags?: string[]
  updatedAt: string
}

/**
 * Provider abstraction for requirement data access.
 * First version uses MockRequirementProvider.
 * Future: replace with HttpRequirementProvider for real backend.
 */
export interface RequirementProvider {
  listRequirements(): Promise<RequirementItem[]>
  getRequirementDetail(id: string): Promise<RequirementItem | undefined>
}

/** The source mode for filling content — raw requirement or enhanced prompt */
export type RequirementSendMode = "raw" | "prompt"

/** Local execution status for a requirement */
export type ExecutionStatus =
  | "not_started"
  | "prompt_created" // legacy
  | "prompt_generated" // new — user clicked "Generate Prompt"
  | "filled_to_chat" // legacy
  | "raw_filled_to_session" // new — raw content filled to session
  | "prompt_filled_to_session" // new — prompt content filled to session
  | "session_created" // legacy
  | "raw_session_created" // new — session created with raw content
  | "prompt_session_created" // new — session created with prompt content
  | "implementing"
  | "done"

/** Persisted record linking a requirement to its execution state */
export interface RequirementExecutionRecord {
  requirementId: string
  projectId: string
  sessionId?: string
  sourceMode: RequirementSendMode
  content: string
  status: ExecutionStatus
  createdAt: string
  updatedAt: string
}
