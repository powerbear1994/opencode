import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"
import type { LinkStatus, RequirementSessionLink, RequirementSendMode } from "../types"
import { uuid } from "@/utils/uuid"

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "opencode.requirement.session.links"
const PENDING_LINK_KEY = "opencode.requirement.pending.link"

// ── Migration from old execution records ─────────────────────────────────────

const OLD_STORAGE_KEY = "opencode.requirement.execution.records"

function migrateOldRecords(): RequirementSessionLink[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(OLD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null

    const links: RequirementSessionLink[] = []
    for (const old of parsed) {
      if (!old.sessionId || !old.projectId) continue
      links.push({
        id: uuid(),
        projectId: old.projectId ?? "",
        projectPath: old.projectPath,
        requirementId: old.requirementId ?? "",
        requirementTitle: old.requirementTitle ?? "",
        sessionId: old.sessionId,
        sessionTitle: old.sessionTitle ?? "",
        sourceMode: "raw",
        status: migrateStatus(old.status ?? "not_started"),
        isPrimary: true,
        content: old.content ?? old.prompt ?? "",
        createdAt: old.createdAt ?? new Date().toISOString(),
        updatedAt: old.updatedAt ?? new Date().toISOString(),
        startedAt: old.startedAt,
        completedAt: old.completedAt,
      })
    }
    // Remove old records after migration
    window.localStorage.removeItem(OLD_STORAGE_KEY)
    return links
  } catch {
    return null
  }
}

function migrateStatus(old: string): LinkStatus {
  const map: Record<string, LinkStatus> = {
    not_started: "not_started",
    prompt_created: "not_started",
    prompt_generated: "not_started",
    filled_to_chat: "filled_to_session",
    raw_filled_to_session: "filled_to_session",
    prompt_filled_to_session: "filled_to_session",
    session_created: "session_created",
    raw_session_created: "session_created",
    prompt_session_created: "session_created",
    implementing: "implementing",
    waiting_review: "waiting_review",
    done: "done",
    failed: "failed",
  }
  return map[old] ?? "not_started"
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalize(raw: any): RequirementSessionLink {
  return {
    id: raw.id ?? uuid(),
    projectId: raw.projectId ?? "",
    projectName: raw.projectName,
    projectPath: raw.projectPath,
    requirementId: raw.requirementId ?? "",
    requirementTitle: raw.requirementTitle ?? "",
    sessionId: raw.sessionId ?? "",
    sessionTitle: raw.sessionTitle ?? "",
    sessionDirectory: raw.sessionDirectory,
    sourceMode: "raw",
    status: raw.status ?? "not_started",
    isPrimary: raw.isPrimary,
    content: raw.content,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
  }
}

function loadLinks(): RequirementSessionLink[] {
  if (typeof window === "undefined") return []
  try {
    // Try migration first
    const migrated = migrateOldRecords()
    if (migrated) return migrated

    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalize)
  } catch {
    return []
  }
}

function saveLinks(links: RequirementSessionLink[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(links))
  } catch {}
}

// ── Pending Link (for new sessions not yet created) ─────────────────────────

export interface PendingRequirementLink {
  projectId: string
  projectPath?: string
  requirementId: string
  requirementTitle: string
  sourceMode: RequirementSendMode
  content?: string
  createdAt: string
}

/** Store a pending requirement link before navigating to create a new session.
 *  Uses sessionStorage so it survives SPA navigation but not tab close. */
export function storePendingRequirementLink(
  info: Omit<PendingRequirementLink, "createdAt">,
): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      PENDING_LINK_KEY,
      JSON.stringify({ ...info, createdAt: new Date().toISOString() }),
    )
  } catch { /* ignore */ }
}

/** Consume (read + remove) a pending requirement link for a given project.
 *  Returns null if no pending link exists or projectId doesn't match. */
export function consumePendingRequirementLink(
  projectId: string,
): PendingRequirementLink | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(PENDING_LINK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingRequirementLink
    if (parsed.projectId !== projectId) return null
    window.sessionStorage.removeItem(PENDING_LINK_KEY)
    return parsed
  } catch {
    return null
  }
}

// ── Singleton Store ──────────────────────────────────────────────────────────

let store: RequirementSessionLink[] | undefined
let setStore: SetStoreFunction<RequirementSessionLink[]> | undefined

function ensureStore() {
  if (!store || !setStore) {
    const [s, ss] = createStore<RequirementSessionLink[]>(loadLinks())
    store = s
    setStore = ss
  }
  return { links: store as RequirementSessionLink[], setLinks: setStore! }
}

/**
 * Create a requirement-session link directly, outside of a SolidJS component.
 * Used by the session submission flow where hooks aren't available.
 * Writes through the reactive store if initialized, otherwise falls back to
 * localStorage-only (the store will pick it up on next init).
 */
export function createRequirementLinkDirect(
  link: Omit<RequirementSessionLink, "id" | "createdAt" | "updatedAt">,
): RequirementSessionLink {
  const now = new Date().toISOString()

  // If the reactive store is initialized, use it (keeps UI reactive)
  if (setStore) {
    const existing = store!.filter(
      (l) => l.projectId === link.projectId && l.requirementId === link.requirementId,
    )
    const isFirst = existing.length === 0

    const newLink: RequirementSessionLink = {
      ...link,
      id: uuid(),
      isPrimary: link.isPrimary ?? isFirst,
      createdAt: now,
      updatedAt: now,
    }

    setStore(store!.length, newLink)
    saveLinks([...store!])
    return newLink
  }

  // Fallback: write directly to localStorage (reactive store not yet initialized)
  const links = loadLinks()
  const existing = links.filter(
    (l) => l.projectId === link.projectId && l.requirementId === link.requirementId,
  )
  const isFirst = existing.length === 0

  const newLink: RequirementSessionLink = {
    ...link,
    id: uuid(),
    isPrimary: link.isPrimary ?? isFirst,
    createdAt: now,
    updatedAt: now,
  }

  links.push(newLink)
  saveLinks(links)
  return newLink
}

// ── Public Hook ──────────────────────────────────────────────────────────────

export function useRequirementLinks() {
  const { links, setLinks } = ensureStore()

  /** Get all links for a requirement within a project */
  function getLinksByRequirement(projectId: string, requirementId: string): RequirementSessionLink[] {
    return links.filter(
      (l) => l.projectId === projectId && l.requirementId === requirementId,
    )
  }

  /** Get all links for a session within a project */
  function getLinksBySession(projectId: string, sessionId: string): RequirementSessionLink[] {
    return links.filter(
      (l) => l.projectId === projectId && l.sessionId === sessionId,
    )
  }

  /** Get the primary (first) link for a requirement */
  function getPrimaryLink(projectId: string, requirementId: string): RequirementSessionLink | undefined {
    return links.find(
      (l) => l.projectId === projectId && l.requirementId === requirementId && l.isPrimary,
    ) ?? links.find(
      (l) => l.projectId === projectId && l.requirementId === requirementId,
    )
  }

  /** Create a new link */
  function createLink(link: Omit<RequirementSessionLink, "id" | "createdAt" | "updatedAt">): RequirementSessionLink {
    const now = new Date().toISOString()
    // If this is the first link for the requirement, make it primary
    const existing = getLinksByRequirement(link.projectId, link.requirementId)
    const isFirst = existing.length === 0

    const newLink: RequirementSessionLink = {
      ...link,
      id: uuid(),
      isPrimary: link.isPrimary ?? isFirst,
      createdAt: now,
      updatedAt: now,
    }

    const next = [...links, newLink]
    setLinks(links.length, newLink)
    saveLinks(next)
    return newLink
  }

  /** Remove a link */
  function removeLink(linkId: string): void {
    const idx = links.findIndex((l) => l.id === linkId)
    if (idx < 0) return
    const removed = links[idx]
    const next = links.filter((l) => l.id !== linkId)

    // If this was the primary link, promote the next one
    if (removed.isPrimary) {
      const sibling = next.find(
        (l) => l.projectId === removed.projectId && l.requirementId === removed.requirementId,
      )
      if (sibling) sibling.isPrimary = true
    }

    setLinks(reconcile(next))
    saveLinks(next)
  }

  /**
   * Remove all links between a requirement and a session (scoped to project).
   * Does NOT delete the real session or its messages.
   */
  function unlinkRequirementFromSession(projectId: string, requirementId: string, sessionId: string): void {
    const next = links.filter(
      (l) => !(l.projectId === projectId && l.requirementId === requirementId && l.sessionId === sessionId),
    )
    if (next.length === links.length) return

    // If the removed link was primary, promote another
    const removed = links.find(
      (l) => l.projectId === projectId && l.requirementId === requirementId && l.sessionId === sessionId,
    )
    if (removed?.isPrimary) {
      const sibling = next.find(
        (l) => l.projectId === projectId && l.requirementId === requirementId,
      )
      if (sibling) sibling.isPrimary = true
    }

    setLinks(reconcile(next))
    saveLinks(next)
  }

  /** Update link status */
  function updateLinkStatus(linkId: string, status: LinkStatus): void {
    const idx = links.findIndex((l) => l.id === linkId)
    if (idx < 0) return
    const now = new Date().toISOString()
    setLinks(idx, "status", status)
    setLinks(idx, "updatedAt", now)
    if (status === "implementing" && !links[idx].startedAt) {
      setLinks(idx, "startedAt", now)
    }
    if (status === "done") {
      setLinks(idx, "completedAt", now)
    }
    saveLinks([...links])
  }

  return {
    links,
    getLinksByRequirement,
    getLinksBySession,
    getPrimaryLink,
    createLink,
    removeLink,
    unlinkRequirementFromSession,
    updateLinkStatus,
    storePendingLink: storePendingRequirementLink,
    consumePendingLink: consumePendingRequirementLink,
  }
}
