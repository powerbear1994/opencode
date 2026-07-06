import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { uuid } from "@/utils/uuid"
import type { LinkStatus, RequirementItem, RequirementSendMode, RequirementSessionLink } from "../types"

export interface RequirementWorkflowRecord {
  projectId: string
  requirementId: string
  lockedAt?: string
  designGeneratedAt?: string
  designLockedAt?: string
  developmentGeneratedAt?: string
  developmentLockedAt?: string
  testGeneratedAt?: string
  testLockedAt?: string
}

export interface StoredRequirement {
  version: 1
  id: string
  projectId: string
  projectPath?: string
  title: string
  description: string
  status: RequirementItem["status"]
  priority: RequirementItem["priority"]
  assignee?: string
  implementer?: string
  createdAt: string
  updatedAt: string
  workflow: RequirementWorkflowRecord
  documents: {
    requirement: string
    design: string
    development: string
    test: string
  }
  sessionLinks: RequirementSessionLink[]
}

interface RequirementIndex {
  version: 1
  requirements: RequirementItem[]
}

const ROOT = ".opencode/requirements"
const INDEX_PATH = `${ROOT}/index.json`
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz"
const ID_RANDOM_LENGTH = 7

export const requirementMetadataPath = (requirementId: string) => `${ROOT}/${safeRequirementId(requirementId)}.json`

export function requirementDocuments(requirementId: string) {
  const id = safeRequirementId(requirementId)
  return {
    requirement: `docs/ai-workflow/${id}/01-requirement.md`,
    design: `docs/ai-workflow/${id}/02-design.md`,
    development: `docs/ai-workflow/${id}/03-development.md`,
    test: `docs/ai-workflow/${id}/04-test.md`,
  }
}

export async function listRequirements(input: { server?: ServerConnection.Any; project: string }) {
  if (!input.project) return []
  return (await readIndex(input)).requirements
}

export async function getRequirement(input: { server?: ServerConnection.Any; project: string; requirementId: string }) {
  const stored = await readStoredRequirement(input)
  return stored ? toRequirementItem(stored) : undefined
}

export async function createRequirement(input: {
  server?: ServerConnection.Any
  project: string
  requirement: Pick<RequirementItem, "title" | "description" | "priority" | "assignee" | "implementer">
}) {
  const index = await readIndex(input)
  const id = await nextRequirementID(input, index.requirements)
  const now = new Date().toISOString()
  const stored = normalizeStoredRequirement(
    {
      version: 1,
      id,
      projectId: input.project,
      projectPath: input.project,
      title: input.requirement.title,
      description: input.requirement.description,
      status: "pending",
      priority: input.requirement.priority,
      assignee: input.requirement.assignee,
      implementer: input.requirement.implementer,
      createdAt: now,
      updatedAt: now,
      workflow: {
        projectId: input.project,
        requirementId: id,
      },
      documents: requirementDocuments(id),
      sessionLinks: [],
    },
    input.project,
    id,
  )

  await writeStoredRequirement(input, stored)
  await writeIndex(input, {
    version: 1,
    requirements: [toRequirementItem(stored), ...index.requirements],
  })
  return toRequirementItem(stored)
}

export async function updateRequirementWorkflow(input: {
  server?: ServerConnection.Any
  project: string
  requirementId: string
  update: (workflow: RequirementWorkflowRecord) => RequirementWorkflowRecord
}) {
  await updateStoredRequirement(input, (stored) => ({
    ...stored,
    workflow: normalizeWorkflow(input.update(stored.workflow), input.project, stored.id),
  }))
}

export async function updateRequirementLinks(input: {
  server?: ServerConnection.Any
  project: string
  requirementId: string
  update: (links: RequirementSessionLink[]) => RequirementSessionLink[]
}) {
  await updateStoredRequirement(input, (stored) => ({
    ...stored,
    sessionLinks: uniqueLinks(input.update(stored.sessionLinks).map(normalizeLink)),
  }))
}

export async function loadRequirementWorkflowRecords(input: { server?: ServerConnection.Any; project: string }) {
  const requirements = await readStoredRequirements(input)
  return requirements.map((requirement) => requirement.workflow)
}

export async function loadRequirementLinks(input: { server?: ServerConnection.Any; project: string }) {
  const requirements = await readStoredRequirements(input)
  return requirements.flatMap((requirement) => requirement.sessionLinks)
}

async function updateStoredRequirement(
  input: { server?: ServerConnection.Any; project: string; requirementId: string },
  update: (stored: StoredRequirement) => StoredRequirement,
) {
  const existing = await readStoredRequirement(input)
  if (!existing) return
  const stored = normalizeStoredRequirement(
    {
      ...update(existing),
      updatedAt: new Date().toISOString(),
    },
    input.project,
    input.requirementId,
  )
  await writeStoredRequirement(input, stored)
  await upsertIndexItem(input, toRequirementItem(stored))
}

async function readStoredRequirements(input: { server?: ServerConnection.Any; project: string }) {
  const index = await readIndex(input)
  return (
    await Promise.all(
      index.requirements.map((requirement) =>
        readStoredRequirement({ ...input, requirementId: requirement.id }),
      ),
    )
  ).filter((requirement): requirement is StoredRequirement => !!requirement)
}

async function readStoredRequirement(input: { server?: ServerConnection.Any; project: string; requirementId: string }) {
  const value = await readJson(input, requirementMetadataPath(input.requirementId))
  if (!value) return undefined
  return normalizeStoredRequirement(value, input.project, input.requirementId)
}

async function writeStoredRequirement(
  input: { server?: ServerConnection.Any; project: string },
  requirement: StoredRequirement,
) {
  await writeJson(input, requirementMetadataPath(requirement.id), requirement)
}

async function readIndex(input: { server?: ServerConnection.Any; project: string }): Promise<RequirementIndex> {
  const value = await readJson(input, INDEX_PATH)
  if (!value) return { version: 1, requirements: [] }
  const raw = typeof value === "object" && value !== null ? value as Partial<RequirementIndex> : {}
  const requirements = Array.isArray(raw.requirements)
    ? raw.requirements.map((item) => normalizeRequirementItem(item, input.project))
    : []
  return { version: 1, requirements: uniqueRequirements(requirements) }
}

async function writeIndex(input: { server?: ServerConnection.Any; project: string }, index: RequirementIndex) {
  await writeJson(input, INDEX_PATH, {
    version: 1,
    requirements: uniqueRequirements(index.requirements).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })
}

async function upsertIndexItem(
  input: { server?: ServerConnection.Any; project: string },
  requirement: RequirementItem,
) {
  const index = await readIndex(input)
  await writeIndex(input, {
    version: 1,
    requirements: [requirement, ...index.requirements.filter((item) => item.id !== requirement.id)],
  })
}

async function readJson(input: { server?: ServerConnection.Any; project: string }, path: string) {
  const response = await fetch(requirementUrl(input.server, input.project, readPath(path)), {
    headers: requestHeaders(input.server, input.project),
  })
  if (!response.ok) return undefined
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

async function writeJson(input: { server?: ServerConnection.Any; project: string }, path: string, value: unknown) {
  const response = await fetch(requirementUrl(input.server, input.project, "/api/fs/write"), {
    method: "POST",
    headers: {
      ...requestHeaders(input.server, input.project),
      "content-type": "application/json",
    },
    body: JSON.stringify({ path, content: `${JSON.stringify(value, null, 2)}\n` }),
  })
  if (!response.ok) throw new Error(`Failed to write ${path}: ${response.status}`)
}

function toRequirementItem(stored: StoredRequirement): RequirementItem {
  return {
    id: stored.id,
    projectId: stored.projectId,
    projectPath: stored.projectPath,
    title: stored.title,
    status: stored.status,
    priority: stored.priority,
    description: stored.description,
    assignee: stored.assignee,
    implementer: stored.implementer,
    updatedAt: stored.updatedAt,
  }
}

function normalizeStoredRequirement(input: unknown, project: string, requirementId: string): StoredRequirement {
  const raw = typeof input === "object" && input !== null ? input as Partial<StoredRequirement> : {}
  const id = raw.id || requirementId
  const now = new Date().toISOString()
  return {
    version: 1,
    id,
    projectId: raw.projectId || project,
    projectPath: raw.projectPath || project,
    title: typeof raw.title === "string" ? raw.title : id,
    description: typeof raw.description === "string" ? raw.description : "",
    status: normalizeStatus(raw.status),
    priority: normalizePriority(raw.priority),
    assignee: raw.assignee,
    implementer: raw.implementer,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    workflow: normalizeWorkflow(raw.workflow, project, id),
    documents: {
      ...requirementDocuments(id),
      ...(typeof raw.documents === "object" && raw.documents !== null ? raw.documents : {}),
    },
    sessionLinks: Array.isArray(raw.sessionLinks) ? uniqueLinks(raw.sessionLinks.map(normalizeLink)) : [],
  }
}

function normalizeRequirementItem(input: unknown, project: string): RequirementItem {
  const raw = typeof input === "object" && input !== null ? input as Partial<RequirementItem> : {}
  const id = raw.id || `#${randomLetters(ID_RANDOM_LENGTH)}`
  return {
    id,
    projectId: raw.projectId || project,
    projectPath: raw.projectPath || project,
    title: typeof raw.title === "string" ? raw.title : id,
    status: normalizeStatus(raw.status),
    priority: normalizePriority(raw.priority),
    description: typeof raw.description === "string" ? raw.description : "",
    assignee: raw.assignee,
    implementer: raw.implementer,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  }
}

export function normalizeWorkflow(input: unknown, project: string, requirementId: string): RequirementWorkflowRecord {
  const raw = typeof input === "object" && input !== null ? input as Partial<RequirementWorkflowRecord> : {}
  return {
    projectId: raw.projectId || project,
    requirementId: raw.requirementId || requirementId,
    lockedAt: raw.lockedAt,
    designGeneratedAt: raw.designGeneratedAt,
    designLockedAt: raw.designLockedAt,
    developmentGeneratedAt: raw.developmentGeneratedAt,
    developmentLockedAt: raw.developmentLockedAt,
    testGeneratedAt: raw.testGeneratedAt,
    testLockedAt: raw.testLockedAt,
  }
}

export function normalizeLink(input: unknown): RequirementSessionLink {
  const raw = typeof input === "object" && input !== null ? input as Partial<RequirementSessionLink> : {}
  const now = new Date().toISOString()
  return {
    id: raw.id || uuid(),
    projectId: raw.projectId || "",
    projectName: raw.projectName,
    projectPath: raw.projectPath,
    requirementId: raw.requirementId || "",
    requirementTitle: raw.requirementTitle || "",
    sessionId: raw.sessionId || "",
    sessionTitle: raw.sessionTitle || "",
    sessionDirectory: raw.sessionDirectory,
    sourceMode: normalizeSourceMode(raw.sourceMode),
    status: normalizeLinkStatus(raw.status),
    isPrimary: raw.isPrimary,
    content: raw.content,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
  }
}

function uniqueRequirements(requirements: RequirementItem[]) {
  const seen = new Set<string>()
  return requirements.filter((requirement) => {
    if (seen.has(requirement.id)) return false
    seen.add(requirement.id)
    return true
  })
}

export function uniqueLinks(links: RequirementSessionLink[]) {
  const seen = new Set<string>()
  return links.filter((link) => {
    const key = `${link.projectId}\u0000${link.requirementId}\u0000${link.sessionId}\u0000${link.sourceMode}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function nextRequirementID(input: { server?: ServerConnection.Any; project: string }, requirements: RequirementItem[]) {
  const existing = new Set(requirements.map((requirement) => requirement.id))
  for (;;) {
    const id = `#${randomLetters(ID_RANDOM_LENGTH)}`
    if (existing.has(id)) continue
    if (!(await requirementPathExists(input, id))) return id
  }
}

function randomLetters(length: number) {
  return Array.from({ length }, () => ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]).join("")
}

async function requirementPathExists(input: { server?: ServerConnection.Any; project: string }, requirementId: string) {
  const documents = requirementDocuments(requirementId)
  const paths = [
    requirementMetadataPath(requirementId),
    documents.requirement,
    documents.design,
    documents.development,
    documents.test,
  ]
  return (await Promise.all(paths.map((path) => pathExists(input, path)))).some(Boolean)
}

async function pathExists(input: { server?: ServerConnection.Any; project: string }, path: string) {
  const response = await fetch(requirementUrl(input.server, input.project, readPath(path)), {
    headers: requestHeaders(input.server, input.project),
  })
  return response.ok
}

function readPath(path: string) {
  return `/api/fs/read/${encodeURIComponent(path)}`
}

function normalizeStatus(value: unknown): RequirementItem["status"] {
  if (value === "confirming" || value === "done") return value
  return "pending"
}

function normalizePriority(value: unknown): RequirementItem["priority"] {
  if (value === "high" || value === "low") return value
  return "medium"
}

function normalizeSourceMode(value: unknown): RequirementSendMode {
  if (value === "design" || value === "development" || value === "test") return value
  return "raw"
}

function normalizeLinkStatus(value: unknown): LinkStatus {
  if (
    value === "filled_to_session" ||
    value === "session_created" ||
    value === "implementing" ||
    value === "waiting_review" ||
    value === "done" ||
    value === "failed"
  ) return value
  return "not_started"
}

function requirementUrl(
  server: ServerConnection.Any | undefined,
  project: string,
  pathname: string,
) {
  const url = new URL(pathname, server?.http.url ?? window.location.origin)
  url.searchParams.set("location[directory]", project)
  return url.toString()
}

function requestHeaders(server: ServerConnection.Any | undefined, project: string) {
  const headers: Record<string, string> = {
    "x-opencode-directory": encodeURIComponent(project),
  }
  if (!server?.http.password) return headers
  headers.Authorization = `Basic ${authTokenFromCredentials({
    username: server.http.username,
    password: server.http.password,
  })}`
  return headers
}

function safeRequirementId(requirementId: string) {
  return requirementId.replace(/[\\/]/g, "-").replace(/\.\.+/g, ".")
}
