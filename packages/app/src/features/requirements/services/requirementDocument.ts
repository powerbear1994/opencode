import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import type { RequirementItem } from "../types"
import { getRequirementMetadata, requirementDocuments, type StoredRequirement } from "./requirementProjectStore"

type DocumentKey = keyof StoredRequirement["documents"]

export const requirementDocumentPath = (requirementId: string) =>
  requirementDocuments(requirementId).requirement

export const designDocumentPath = (requirementId: string) =>
  requirementDocuments(requirementId).design

export const developmentDocumentPath = (requirementId: string) =>
  requirementDocuments(requirementId).development

export const testDocumentPath = (requirementId: string) =>
  requirementDocuments(requirementId).test

export async function loadRequirementDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  return loadDocument(input, "requirement", requirementDocumentPath(input.requirement.id))
}

export async function loadDesignDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  return loadDocument(input, "design", designDocumentPath(input.requirement.id))
}

export async function loadDevelopmentDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  return loadDocument(input, "development", developmentDocumentPath(input.requirement.id))
}

export async function loadTestDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  requirement: RequirementItem
}) {
  return loadDocument(input, "test", testDocumentPath(input.requirement.id))
}

export async function saveRequirementDocument(input: {
  server: ServerConnection.Any | undefined
  project: string
  path: string
  content: string
}) {
  await writeRequirementDocument(input.server, input.project, input.path, input.content)
}

async function loadDocument(
  input: {
    server: ServerConnection.Any | undefined
    project: string
    requirement: RequirementItem
  },
  key: DocumentKey,
  defaultPath: string,
) {
  const metadata = await getRequirementMetadata({
    server: input.server,
    project: input.project,
    requirementId: input.requirement.id,
  })
  const paths = uniquePaths([metadata?.documents[key], defaultPath])
  for (const path of paths) {
    const content = await readRequirementDocument(input.server, input.project, path)
    if (content !== undefined) return { path, content, created: false }
  }
  return undefined
}

async function readRequirementDocument(server: ServerConnection.Any | undefined, project: string, path: string) {
  const response = await fetch(requirementUrl(server, project, readPath(path)), {
    headers: requestHeaders(server, project),
  })
  if (!response.ok) return undefined
  return await response.text()
}

function readPath(path: string) {
  return `/api/fs/read/${encodeURIComponent(path)}`
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

function uniquePaths(paths: Array<string | undefined>) {
  const seen = new Set<string>()
  return paths
    .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    .map((path) => path.trim())
    .filter((path) => {
      if (seen.has(path)) return false
      seen.add(path)
      return true
    })
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
