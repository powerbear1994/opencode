import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import type { RequirementItem } from "../types"

export const requirementDocumentPath = (requirementId: string) =>
  `docs/ai-workflow/${safeRequirementId(requirementId)}/01-requirement.md`

export const designDocumentPath = (requirementId: string) =>
  `docs/ai-workflow/${safeRequirementId(requirementId)}/02-design.md`

export const developmentDocumentPath = (requirementId: string) =>
  `docs/ai-workflow/${safeRequirementId(requirementId)}/03-development.md`

export const testDocumentPath = (requirementId: string) =>
  `docs/ai-workflow/${safeRequirementId(requirementId)}/04-test.md`

export async function loadRequirementDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  const path = requirementDocumentPath(input.requirement.id)
  const content = await readRequirementDocument(input.server, input.project, path)
  if (content !== undefined) return { path, content, created: false }
  return undefined
}

export async function loadDesignDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  const path = designDocumentPath(input.requirement.id)
  const content = await readRequirementDocument(input.server, input.project, path)
  if (content !== undefined) return { path, content, created: false }
  return undefined
}

export async function loadDevelopmentDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  const path = developmentDocumentPath(input.requirement.id)
  const content = await readRequirementDocument(input.server, input.project, path)
  if (content !== undefined) return { path, content, created: false }
  return undefined
}

export async function loadTestDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  const path = testDocumentPath(input.requirement.id)
  const content = await readRequirementDocument(input.server, input.project, path)
  if (content !== undefined) return { path, content, created: false }
  return undefined
}

export async function saveRequirementDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  path: string
  content: string
}) {
  await writeRequirementDocument(input.server, input.project, input.path, input.content)
}

async function readRequirementDocument(server: ServerConnection.Any | undefined, project: string, path: string) {
  if (!(await requirementDocumentExists(server, project, path))) return undefined
  const response = await fetch(requirementUrl(server, project, `/api/fs/read/${path}`), {
    headers: requestHeaders(server, project),
  })
  if (!response.ok) return undefined
  return await response.text()
}

async function requirementDocumentExists(server: ServerConnection.Any | undefined, project: string, path: string) {
  const response = await fetch(requirementUrl(server, project, "/api/fs/find", {
    query: path,
    type: "file",
    limit: "1000",
  }), {
    headers: requestHeaders(server, project),
  })
  if (!response.ok) return false
  const payload = await response.json()
  const entries = Array.isArray(payload) ? payload : payload?.data
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false
    const entryPath = (entry as { path?: unknown }).path
    return typeof entryPath === "string" && entryPath.replace(/\\/g, "/") === path
  })
}

async function writeRequirementDocument(
  server: ServerConnection.Any | undefined,
  project: string,
  path: string,
  content: string,
) {
  const response = await fetch(requirementUrl(server, project, "/api/fs/write"), {
    method: "POST",
    headers: {
      ...requestHeaders(server, project),
      "content-type": "application/json",
    },
    body: JSON.stringify({ path, content }),
  })
  if (!response.ok) throw new Error(`Failed to write ${path}: ${response.status}`)
}

function requirementUrl(
  server: ServerConnection.Any | undefined,
  project: string,
  pathname: string,
  query?: Record<string, string>,
) {
  const url = new URL(pathname, server?.http.url ?? window.location.origin)
  url.searchParams.set("location[directory]", project)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
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
