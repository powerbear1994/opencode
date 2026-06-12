/**
 * Lightweight in-memory store for passing draft content from the Requirements
 * Center to a session page. The session page reads and consumes the draft on
 * mount so content appears in the chat input without being auto-sent.
 *
 * Key format: `${projectId}:${sessionId}`
 *   - "projectId" is the project/workspace directory path
 *   - "sessionId" is the session ID
 *   - This compound key ensures drafts are scoped to the correct project context
 *
 * For new sessions (no session ID yet), the `?prompt=` URL query parameter is
 * used instead (already supported by session.tsx and new-session.tsx).
 */

export interface SessionDraftInput {
  projectId: string
  sessionId: string
  content: string
  updatedAt: string
}

function makeKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`
}

const drafts = new Map<string, SessionDraftInput>()

/** Save draft content for a session. Called by the Requirements detail page before navigation. */
export function setSessionDraftInput(
  projectId: string,
  sessionId: string,
  content: string,
): void {
  const key = makeKey(projectId, sessionId)
  drafts.set(key, {
    projectId,
    sessionId,
    content,
    updatedAt: new Date().toISOString(),
  })
}

/** Get draft content without removing it. Returns undefined if no draft exists. */
export function getSessionDraftInput(
  projectId: string,
  sessionId: string,
): SessionDraftInput | undefined {
  return drafts.get(makeKey(projectId, sessionId))
}

/** Read and remove draft content for a session. Called by the session page on mount. */
export function consumeSessionDraftInput(
  projectId: string,
  sessionId: string,
): string | null {
  const key = makeKey(projectId, sessionId)
  const entry = drafts.get(key)
  if (!entry) return null
  drafts.delete(key)
  return entry.content
}

/** Clear a specific draft without reading it. */
export function clearSessionDraftInput(
  projectId: string,
  sessionId: string,
): void {
  drafts.delete(makeKey(projectId, sessionId))
}

// ── Legacy API (backward compat) ─────────────────────────────────────────────

/** @deprecated Use setSessionDraftInput(projectId, sessionId, content) instead */
export function setSessionDraft(sessionId: string, content: string): void {
  drafts.set(sessionId, {
    projectId: "",
    sessionId,
    content,
    updatedAt: new Date().toISOString(),
  })
}

/** @deprecated Use consumeSessionDraftInput(projectId, sessionId) instead */
export function consumeSessionDraft(sessionId: string): string | null {
  // Also check the new compound-key format as fallback
  for (const [key, entry] of drafts) {
    if (key.endsWith(`:${sessionId}`)) {
      drafts.delete(key)
      return entry.content
    }
  }
  // Legacy lookup
  const entry = drafts.get(sessionId)
  if (entry) {
    drafts.delete(sessionId)
    return entry.content
  }
  return null
}
