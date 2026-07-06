/** A single requirement item matching the RequirementItem data model */
export interface RequirementItem {
  id: string
  projectId: string
  projectPath?: string
  title: string
  status: "pending" | "confirming" | "done"
  priority: "high" | "medium" | "low"
  description: string
  assignee?: string
  implementer?: string
  updatedAt: string
}

/**
 * Provider abstraction for requirement data access.
 * Requirement data is stored in the selected project's .opencode directory.
 */
export interface RequirementProvider {
  listRequirements(projectId: string): Promise<RequirementItem[]>
  getRequirementDetail(projectId: string, id: string): Promise<RequirementItem | undefined>
  createRequirement(
    projectId: string,
    requirement: Pick<RequirementItem, "title" | "description" | "priority" | "assignee" | "implementer">,
  ): Promise<RequirementItem>
}

export type RequirementSendMode = "raw" | "design" | "development" | "test"

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
