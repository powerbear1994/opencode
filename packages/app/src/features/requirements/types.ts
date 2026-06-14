/** A single requirement item matching the RequirementItem data model */
export interface RequirementItem {
  id: string
  title: string
  status: "todo" | "doing" | "waiting_review" | "done" | "failed"
  priority: "high" | "medium" | "low"
  description: string
  assignee?: string
  implementer?: string
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
  | "prompt_generated" // user clicked "Generate Prompt"
  | "filled_to_chat" // legacy
  | "raw_filled_to_session" // raw content filled to session
  | "prompt_filled_to_session" // prompt content filled to session
  | "session_created" // legacy
  | "raw_session_created" // session created with raw content
  | "prompt_session_created" // session created with prompt content
  | "implementing" // manual: working on implementation
  | "waiting_review" // manual: waiting for review
  | "done" // manual: completed
  | "failed" // manual: implementation failed

/** Persisted record linking a requirement to its execution state */
export interface RequirementExecutionRecord {
  requirementId: string
  projectId: string
  sessionId?: string
  sourceMode: RequirementSendMode
  content: string
  status: ExecutionStatus
  sessionTitle?: string
  requirementTitle?: string
  projectName?: string
  projectPath?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  implementationSummary?: string
}

// ── New link-based model (supports many-to-many) ───────────────────────────

/** Simplified status for a requirement-session link */
export type LinkStatus =
  | "not_started"
  | "filled_to_session"
  | "session_created"
  | "implementing"
  | "waiting_review"
  | "done"
  | "failed"

/**
 * A link between one requirement and one session, scoped to a project.
 * Multiple links can reference the same session (many requirements →
 * one session) or the same requirement (one requirement → many sessions).
 */
export interface RequirementSessionLink {
  id: string

  projectId: string
  projectName?: string
  projectPath?: string

  requirementId: string
  requirementTitle: string

  sessionId: string
  sessionTitle: string
  /** The session's actual filesystem directory — may differ from projectId for sandboxes */
  sessionDirectory?: string

  sourceMode: RequirementSendMode

  status: LinkStatus

  /** True if this is the primary/initial link for the requirement */
  isPrimary?: boolean

  content?: string

  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}
