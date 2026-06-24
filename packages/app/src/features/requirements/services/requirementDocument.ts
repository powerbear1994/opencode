import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import type { RequirementItem } from "../types"

export const requirementDocumentPath = (requirementId: string) =>
  `docs/ai-workflow/${safeRequirementId(requirementId)}/01-requirement.md`

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

export async function saveRequirementDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  path: string
  content: string
}) {
  await writeRequirementDocument(input.server, input.project, input.path, input.content)
}

async function readRequirementDocument(server: ServerConnection.Any | undefined, project: string, path: string) {
  const response = await fetch(requirementUrl(server, project, `/api/fs/read/${path}`), {
    headers: requestHeaders(server, project),
  })
  if (!response.ok) return undefined
  return await response.text()
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

function requirementUrl(server: ServerConnection.Any | undefined, project: string, pathname: string) {
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
