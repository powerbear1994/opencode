import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"
import { useServer } from "@/context/server"
import type { ServerConnection } from "@/context/server"
import { uuid } from "@/utils/uuid"
import type { LinkStatus, RequirementSessionLink, RequirementSendMode } from "../types"
import {
  loadRequirementLinks,
  normalizeLink,
  uniqueLinks,
  updateRequirementLinks,
} from "./requirementProjectStore"

const PENDING_LINK_KEY = "opencode.requirement.pending.link"

export interface PendingRequirementLink {
  projectId: string
  projectPath?: string
  requirementId: string
  requirementTitle: string
  sourceMode: RequirementSendMode
  content?: string
  createdAt: string
}

export function storePendingRequirementLink(
  info: Omit<PendingRequirementLink, "createdAt">,
): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      PENDING_LINK_KEY,
      JSON.stringify({ ...info, createdAt: new Date().toISOString() }),
    )
  } catch {}
}

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

let store: RequirementSessionLink[] | undefined
let setStore: SetStoreFunction<RequirementSessionLink[]> | undefined
const loadingProjects = new Set<string>()
const loadedProjects = new Set<string>()
const writeQueues = new Map<string, Promise<void>>()

function ensureStore() {
  if (!store || !setStore) {
    const [s, ss] = createStore<RequirementSessionLink[]>([])
    store = s
    setStore = ss
  }
  return { links: store as RequirementSessionLink[], setLinks: setStore! }
}

function ensureProject(projectId: string, server?: ServerConnection.Any) {
  if (!projectId || loadingProjects.has(projectId) || loadedProjects.has(projectId)) return
  loadingProjects.add(projectId)
  void loadRequirementLinks({ server, project: projectId })
    .then((links) => {
      const current = ensureStore()
      const currentProjectLinks = current.links.filter((link) => link.projectId === projectId)
      const currentKeys = new Set(
        currentProjectLinks.map((link) =>
          `${link.projectId}\u0000${link.requirementId}\u0000${link.sessionId}\u0000${link.sourceMode}`,
        ),
      )
      current.setLinks(reconcile([
        ...current.links.filter((link) => link.projectId !== projectId),
        ...currentProjectLinks,
        ...links.filter((link) =>
          !currentKeys.has(`${link.projectId}\u0000${link.requirementId}\u0000${link.sessionId}\u0000${link.sourceMode}`),
        ),
      ]))
      loadedProjects.add(projectId)
    })
    .finally(() => loadingProjects.delete(projectId))
}

function sameLink(
  a: Pick<RequirementSessionLink, "projectId" | "requirementId" | "sessionId" | "sourceMode">,
  b: Pick<RequirementSessionLink, "projectId" | "requirementId" | "sessionId" | "sourceMode">,
) {
  return (
    a.projectId === b.projectId &&
    a.requirementId === b.requirementId &&
    a.sessionId === b.sessionId &&
    a.sourceMode === b.sourceMode
  )
}

function saveRequirementLinkSet(
  projectId: string,
  requirementId: string,
  links: RequirementSessionLink[],
  server?: ServerConnection.Any,
) {
  queueRequirementLinkWrite(projectId, requirementId, () => updateRequirementLinks({
    server,
    project: projectId,
    requirementId,
    update: () => links.filter((link) => link.projectId === projectId && link.requirementId === requirementId),
  }))
}

function saveRequirementLinkAppend(link: RequirementSessionLink, server?: ServerConnection.Any) {
  queueRequirementLinkWrite(link.projectId, link.requirementId, () => updateRequirementLinks({
    server,
    project: link.projectId,
    requirementId: link.requirementId,
    update: (links) => uniqueLinks([...links, link]),
  }))
}

function queueRequirementLinkWrite(projectId: string, requirementId: string, write: () => Promise<void>) {
  const key = `${projectId}\u0000${requirementId}`
  const next = (writeQueues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(write)
    .catch((error) => {
      console.error("[requirements] failed to persist session link", error)
    })
    .finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key)
    })
  writeQueues.set(key, next)
}

function appendLink(currentLinks: RequirementSessionLink[], link: Omit<RequirementSessionLink, "id" | "createdAt" | "updatedAt">) {
  const duplicate = currentLinks.find((item) => sameLink(item, link))
  if (duplicate) return { links: currentLinks, link: duplicate }

  const now = new Date().toISOString()
  const existing = currentLinks.filter(
    (item) => item.projectId === link.projectId && item.requirementId === link.requirementId,
  )
  const nextLink = normalizeLink({
    ...link,
    id: uuid(),
    isPrimary: link.isPrimary ?? existing.length === 0,
    createdAt: now,
    updatedAt: now,
  })
  return { links: uniqueLinks([...currentLinks, nextLink]), link: nextLink }
}

export function createRequirementLinkDirect(
  link: Omit<RequirementSessionLink, "id" | "createdAt" | "updatedAt">,
): RequirementSessionLink {
  const current = ensureStore()
  const result = appendLink(current.links, link)
  current.setLinks(reconcile(result.links))
  saveRequirementLinkAppend(result.link)
  return result.link
}

export function useRequirementLinks() {
  const server = useServer()
  const { links, setLinks } = ensureStore()

  function getLinksByRequirement(projectId: string, requirementId: string): RequirementSessionLink[] {
    ensureProject(projectId, server.current)
    return links.filter(
      (link) => link.projectId === projectId && link.requirementId === requirementId,
    )
  }

  function getLinksBySession(projectId: string, sessionId: string): RequirementSessionLink[] {
    ensureProject(projectId, server.current)
    return links.filter(
      (link) => link.projectId === projectId && link.sessionId === sessionId,
    )
  }

  function getPrimaryLink(projectId: string, requirementId: string): RequirementSessionLink | undefined {
    return getLinksByRequirement(projectId, requirementId).find((link) => link.isPrimary) ??
      getLinksByRequirement(projectId, requirementId)[0]
  }

  function createLink(link: Omit<RequirementSessionLink, "id" | "createdAt" | "updatedAt">): RequirementSessionLink {
    const result = appendLink(links, link)
    setLinks(reconcile(result.links))
    saveRequirementLinkAppend(result.link, server.current)
    return result.link
  }

  function removeLink(linkId: string): void {
    const removed = links.find((link) => link.id === linkId)
    if (!removed) return
    const next = links.filter((link) => link.id !== linkId)
    const sibling = removed.isPrimary
      ? next.find((link) => link.projectId === removed.projectId && link.requirementId === removed.requirementId)
      : undefined
    const promoted = sibling
      ? next.map((link) => link.id === sibling.id ? { ...link, isPrimary: true } : link)
      : next
    setLinks(reconcile(promoted))
    saveRequirementLinkSet(removed.projectId, removed.requirementId, promoted, server.current)
  }

  function unlinkRequirementFromSession(projectId: string, requirementId: string, sessionId: string): void {
    const removed = links.find(
      (link) => link.projectId === projectId && link.requirementId === requirementId && link.sessionId === sessionId,
    )
    const next = links.filter(
      (link) => !(link.projectId === projectId && link.requirementId === requirementId && link.sessionId === sessionId),
    )
    if (next.length === links.length) return
    const sibling = removed?.isPrimary
      ? next.find((link) => link.projectId === projectId && link.requirementId === requirementId)
      : undefined
    const promoted = sibling
      ? next.map((link) => link.id === sibling.id ? { ...link, isPrimary: true } : link)
      : next
    setLinks(reconcile(promoted))
    saveRequirementLinkSet(projectId, requirementId, promoted, server.current)
  }

  function removeRequirementLinks(projectId: string, requirementId: string): void {
    const next = links.filter((link) => link.projectId !== projectId || link.requirementId !== requirementId)
    if (next.length === links.length) return
    setLinks(reconcile(next))
  }

  function updateLinkStatus(linkId: string, status: LinkStatus): void {
    const target = links.find((link) => link.id === linkId)
    if (!target) return
    const now = new Date().toISOString()
    const next = links.map((link) => {
      if (link.id !== linkId) return link
      return {
        ...link,
        status,
        updatedAt: now,
        startedAt: status === "implementing" ? link.startedAt ?? now : link.startedAt,
        completedAt: status === "done" ? now : link.completedAt,
      }
    })
    setLinks(reconcile(next))
    saveRequirementLinkSet(target.projectId, target.requirementId, next, server.current)
  }

  return {
    links,
    getLinksByRequirement,
    getLinksBySession,
    getPrimaryLink,
    createLink,
    removeLink,
    unlinkRequirementFromSession,
    removeRequirementLinks,
    updateLinkStatus,
    storePendingLink: storePendingRequirementLink,
    consumePendingLink: consumePendingRequirementLink,
  }
}
