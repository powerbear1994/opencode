/**
 * Lightweight in-memory store for passing draft content from the Requirements
 * Center to a session page. The session page reads and consumes the draft on
 * mount so content appears in the chat input without being auto-sent.
 *
 * Key = session ID string. For new sessions (no session ID yet), the
 * `?prompt=` URL query parameter is used instead (already supported by
 * session.tsx).
 */

const drafts = new Map<string, string>()

/** Save draft content for a session. Called by the Requirements detail page. */
export function setSessionDraft(sessionId: string, content: string): void {
  drafts.set(sessionId, content)
}

/** Read and remove draft content for a session. Called by the session page on mount. */
export function consumeSessionDraft(sessionId: string): string | null {
  const content = drafts.get(sessionId) ?? null
  drafts.delete(sessionId)
  return content
}
