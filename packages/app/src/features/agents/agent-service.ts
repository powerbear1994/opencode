import type { Agent } from "@opencode-ai/sdk/v2/client"
import type { AgentFileContent, AgentFormData, AgentSource } from "./types"
import { isBuiltinAgent } from "./types"
import { authTokenFromCredentials } from "@/utils/server"

// ── Auth ───────────────────────────────────────────────────────────────────────

export interface ServerAuth {
  url: string
  username?: string
  password?: string
}

function buildAuthHeaders(auth: ServerAuth): Record<string, string> {
  const headers: Record<string, string> = {}
  if (auth.password) {
    headers["Authorization"] = `Basic ${authTokenFromCredentials({ username: auth.username, password: auth.password })}`
  }
  return headers
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function buildLocationParam(directory: string): string {
  return `location[directory]=${encodeURIComponent(directory)}`
}

async function apiGetRaw(base: string, path: string, auth: ServerAuth): Promise<any> {
  const resp = await fetch(`${base}${path}`, { headers: buildAuthHeaders(auth) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`Agent API error (${resp.status}): ${text}`)
  }
  return resp.json()
}

async function apiPost<T>(base: string, path: string, body: unknown, auth: ServerAuth): Promise<T> {
  const resp = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(auth) },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`Agent API error (${resp.status}): ${text}`)
  }
  const json = await resp.json()
  return json.data as T
}

async function apiPostRaw<T>(base: string, path: string, body: unknown, auth: ServerAuth): Promise<T> {
  const resp = await fetch(path.startsWith("http") ? path : `${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(auth) },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`Agent API error (${resp.status}): ${text}`)
  }
  const text = await resp.text()
  if (!text) return undefined as T
  if (!resp.headers.get("content-type")?.includes("json")) {
    throw new Error("Agent API returned a non-JSON response. Check that the backend route is available.")
  }
  return JSON.parse(text) as T
}

async function apiPut<T>(base: string, path: string, body: unknown, auth: ServerAuth): Promise<T> {
  const resp = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(auth) },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`Agent API error (${resp.status}): ${text}`)
  }
  const json = await resp.json()
  return json.data as T
}

async function apiDelete(base: string, path: string, auth: ServerAuth): Promise<void> {
  const resp = await fetch(`${base}${path}`, {
    method: "DELETE",
    headers: buildAuthHeaders(auth),
  })
  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`Delete failed (${resp.status}): ${text}`)
  }
}

// ── Normalize API response ─────────────────────────────────────────────────────

function normalizeAgent(raw: any): Agent {
  return {
    name: raw.name ?? raw.id ?? "",
    description: raw.description,
    mode: raw.mode ?? "all",
    native: raw.native,
    hidden: raw.hidden,
    topP: raw.topP ?? raw.top_p,
    temperature: raw.temperature,
    color: raw.color,
    permission: raw.permission ?? raw.permissions ?? [],
    model: raw.model ? { modelID: raw.model.modelID ?? raw.model.id, providerID: raw.model.providerID } : undefined,
    variant: raw.variant,
    prompt: raw.prompt ?? raw.system,
    options: raw.options ?? {},
    steps: raw.steps,
  }
}

function normalizeAgentList(raw: unknown): Agent[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(normalizeAgent).filter((a) => a.name && a.mode)
  if (typeof raw === "object")
    return Object.values(raw)
      .map(normalizeAgent)
      .filter((a) => a.name && a.mode)
  return []
}

// ── Agent source detection ─────────────────────────────────────────────────────

async function detectSource(base: string, directory: string, agent: Agent, auth: ServerAuth): Promise<AgentSource> {
  // File/config definitions can intentionally override a built-in by name, so
  // check concrete locations before falling back to the name-based built-in set.
  const exists = async (agentLocation: AgentSource) => {
    const resp = await fetch(
      `${base}/api/agent/${encodeURIComponent(agent.name)}?location[directory]=${encodeURIComponent(directory)}&agentLocation=${agentLocation}`,
      { headers: buildAuthHeaders(auth) },
    )
    return resp.ok
  }
  try {
    if (await exists("project")) return "project"
  } catch {
    /* ignore */
  }
  try {
    if (await exists("global")) return "global"
  } catch {
    /* ignore */
  }
  try {
    if (await exists("project-config")) return "project-config"
  } catch {
    /* ignore */
  }
  try {
    if (await exists("global-config")) return "global-config"
  } catch {
    /* ignore */
  }
  if (isBuiltinAgent(agent.name)) return "built-in"
  return "unknown"
}

// ── API ────────────────────────────────────────────────────────────────────────

export interface AgentService {
  listAgents(): Promise<{ agents: Agent[]; sources: Map<string, AgentSource>; debug: any }>
  readAgentFile(id: string, location: string): Promise<AgentFileContent>
  generateAgent(input: {
    name: string
    description: string
    model?: { providerID: string; modelID: string }
  }): Promise<Pick<AgentFormData, "name" | "description" | "mode" | "prompt">>
  createAgent(data: AgentFormData): Promise<{ name: string; path: string }>
  updateAgent(id: string, data: AgentFormData): Promise<{ name: string; path: string }>
  deleteAgent(id: string, location: string): Promise<void>
  disposeInstance(): Promise<void>
}

export function createAgentService(auth: ServerAuth, directory: string): AgentService {
  const base = auth.url.replace(/\/$/, "")

  return {
    async listAgents() {
      const json = await apiGetRaw(base, `/api/agent?${buildLocationParam(directory)}`, auth)

      // Diagnostic logging
      const rawData = json.data ?? json
      console.log("[agents] API raw response:", {
        hasLocation: !!json.location,
        locationDir: json.location?.directory,
        dataType: Array.isArray(rawData) ? "array" : typeof rawData,
        dataCount: Array.isArray(rawData) ? rawData.length : Object.keys(rawData ?? {}).length,
        sampleKeys: Array.isArray(rawData) && rawData.length > 0 ? Object.keys(rawData[0]).slice(0, 8) : "N/A",
      })

      const agents = normalizeAgentList(rawData)

      console.log("[agents] After normalization:", {
        total: agents.length,
        builtin: agents.filter((a) => isBuiltinAgent(a.name)).length,
        custom: agents.filter((a) => !isBuiltinAgent(a.name)).length,
        names: agents.map((a) => ({ name: a.name, builtin: isBuiltinAgent(a.name) })),
      })

      // Detect source for every agent because user/project definitions may
      // override a built-in agent by reusing the same name.
      const sources = new Map<string, AgentSource>()
      let detectFailures = 0
      await Promise.all(
        agents
          .map(async (agent) => {
            try {
              const source = await detectSource(base, directory, agent, auth)
              sources.set(agent.name, source)
            } catch (err) {
              detectFailures++
              console.warn(`[agents] Source detection failed for "${agent.name}":`, err)
              sources.set(agent.name, isBuiltinAgent(agent.name) ? "built-in" : "unknown")
            }
          }),
      )

      console.log("[agents] Source detection done:", {
        sources: Object.fromEntries(sources),
        failures: detectFailures,
      })

      return { agents, sources, debug: { rawDataCount: Array.isArray(rawData) ? rawData.length : "N/A" } }
    },

    async readAgentFile(id: string, location: string) {
      const resp = await fetch(
        `${base}/api/agent/${encodeURIComponent(id)}?${buildLocationParam(directory)}&agentLocation=${location}`,
        { headers: buildAuthHeaders(auth) },
      )
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText)
        throw new Error(`Agent API error (${resp.status}): ${text}`)
      }
      const json = await resp.json()
      const data = json.data as AgentFileContent
      console.log(`[agents] Read file for "${id}" (${location}):`, {
        hasFrontmatter: !!data.frontmatter,
        bodyLen: data.body?.length,
      })
      return data
    },

    async generateAgent(input: {
      name: string
      description: string
      model?: { providerID: string; modelID: string }
    }) {
      const url = new URL("/agent/generate", `${base}/`)
      if (directory) url.searchParams.set("directory", directory)
      return apiPostRaw<Pick<AgentFormData, "name" | "description" | "mode" | "prompt">>(
        base,
        url.toString(),
        input,
        auth,
      )
    },

    async createAgent(data: AgentFormData) {
      return apiPost<{ name: string; path: string }>(
        base,
        `/api/agent?${buildLocationParam(directory)}`,
        {
          name: data.name,
          location: data.location,
          description: data.description || undefined,
          mode: data.mode,
          model: data.model,
          steps: data.steps || undefined,
          temperature: data.temperature,
          color: data.color,
          hidden: data.hidden,
          disable: data.disable,
          permission:
            data.permissions.length > 0
              ? Object.fromEntries(data.permissions.map((p) => [p.tool, p.action]))
              : undefined,
          prompt: data.prompt,
        },
        auth,
      )
    },

    async updateAgent(id: string, data: AgentFormData) {
      return apiPut<{ name: string; path: string }>(
        base,
        `/api/agent/${encodeURIComponent(id)}?${buildLocationParam(directory)}`,
        {
          location: data.location,
          description: data.description || undefined,
          mode: data.mode,
          model: data.model,
          steps: data.steps || undefined,
          temperature: data.temperature,
          color: data.color,
          hidden: data.hidden,
          disable: data.disable,
          permission:
            data.permissions.length > 0
              ? Object.fromEntries(data.permissions.map((p) => [p.tool, p.action]))
              : undefined,
          prompt: data.prompt,
        },
        auth,
      )
    },

    async deleteAgent(id: string, location: string) {
      await apiDelete(
        base,
        `/api/agent/${encodeURIComponent(id)}?${buildLocationParam(directory)}&agentLocation=${location}`,
        auth,
      )
    },

    async disposeInstance() {
      const resp = await fetch(`${base}/instance/dispose?directory=${encodeURIComponent(directory)}`, {
        method: "POST",
        headers: buildAuthHeaders(auth),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText)
        throw new Error(`Instance dispose failed (${resp.status}): ${text}`)
      }
    },
  }
}
