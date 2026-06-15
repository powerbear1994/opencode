import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import path from "path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../groups/location"

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILTIN_AGENTS = new Set([
  "build",
  "plan",
  "general",
  "explore",
  "scout",
  "compaction",
  "title",
  "summary",
])

// ── Frontmatter serializer ─────────────────────────────────────────────────────

function stringifyYamlValue(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent)
  if (value === null || value === undefined) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") {
    // Quote strings that contain special chars
    if (/[:\n'"#&*!|>%@`{}[\]",\s]/.test(value) || value === "") {
      return JSON.stringify(value)
    }
    return value
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    return "\n" + entries
      .map(([k, v]) => `${pad}  ${k}: ${stringifyYamlValue(v, indent + 1)}`)
      .join("\n")
  }
  return String(value)
}

function stringifyFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ["---"]
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    lines.push(`${key}: ${stringifyYamlValue(value)}`)
  }
  lines.push("---")
  return lines.join("\n")
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function validateSlug(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error("Agent name is required")
  }
  if (!/^[a-z0-9._-]+$/.test(name)) {
    throw new Error("Agent name must only contain lowercase letters, numbers, dots, underscores, and hyphens")
  }
  if (BUILTIN_AGENTS.has(name)) {
    throw new Error(`Cannot use built-in agent name: ${name}`)
  }
}

function agentDir(dir: string, location: "project" | "global"): string {
  if (location === "global") {
    return path.join(Global.Path.config, "agents")
  }
  return path.join(dir, ".opencode", "agents")
}

// ── Handler ────────────────────────────────────────────────────────────────────

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("agent.list", () =>
        Effect.gen(function* () {
          yield* PluginBoot.Service.use((plugin) => plugin.wait())
          return yield* response(AgentV2.Service.use((agent) => agent.all()))
        }),
      )
      .handle(
        "agent.readFile",
        Effect.fn("AgentHandler.readFile")(function* (ctx) {
          const location = yield* Location.Service
          const dir = agentDir(location.directory, ctx.query.agentLocation as "project" | "global")
          const filePath = path.join(dir, `${ctx.params.id}.md`)

          const content: string = yield* Effect.promise(() =>
            import("fs/promises").then((fsp) => fsp.readFile(filePath, "utf-8")),
          )

          const parsed = ConfigMarkdown.parse(content)
          return yield* response(
            Effect.succeed({
              name: ctx.params.id,
              content,
              frontmatter: parsed.data as Record<string, unknown>,
              body: (parsed.content as string).trim(),
            }),
          )
        }),
      )
      .handle(
        "agent.create",
        Effect.fn("AgentHandler.create")(function* (ctx) {
          const fsp = yield* Effect.promise(() => import("fs/promises"))
          const slug = sanitizeSlug(ctx.payload.name)
          validateSlug(slug)

          const locationSvc = yield* Location.Service
          const loc = ctx.payload.location as "project" | "global"
          const dir = agentDir(locationSvc.directory, loc)
          const filePath = path.join(dir, `${slug}.md`)

          // Check if file already exists
          const fileExists: boolean = yield* Effect.promise(async () => {
            try {
              await fsp.access(filePath)
              return true
            } catch {
              return false
            }
          })
          if (fileExists) {
            throw new Error(`Agent "${slug}" already exists`)
          }

          // Build frontmatter
          const fm: Record<string, unknown> = {}
          if (ctx.payload.description) fm.description = ctx.payload.description
          if (ctx.payload.mode) fm.mode = ctx.payload.mode
          if (ctx.payload.model) fm.model = ctx.payload.model
          if (ctx.payload.temperature !== undefined) fm.temperature = ctx.payload.temperature
          if (ctx.payload.color) fm.color = ctx.payload.color
          if (ctx.payload.hidden !== undefined) fm.hidden = ctx.payload.hidden
          if (ctx.payload.disable !== undefined) fm.disable = ctx.payload.disable
          if (ctx.payload.permission && Object.keys(ctx.payload.permission).length > 0) {
            fm.permission = ctx.payload.permission
          }

          const body = ctx.payload.prompt || ""
          const frontmatter = stringifyFrontmatter(fm)
          const markdown = frontmatter + "\n" + body + (body ? "\n" : "")

          // Write file
          yield* Effect.promise(() => fsp.mkdir(dir, { recursive: true }))
          yield* Effect.promise(() => fsp.writeFile(filePath, markdown, "utf-8"))

          return yield* response(
            Effect.succeed({ name: slug, path: filePath }),
          )
        }),
      )
      .handle(
        "agent.update",
        Effect.fn("AgentHandler.update")(function* (ctx) {
          const fsp = yield* Effect.promise(() => import("fs/promises"))
          const slug = sanitizeSlug(ctx.params.id)
          validateSlug(slug)

          const locationSvc = yield* Location.Service
          const loc = ctx.payload.location as "project" | "global"
          const dir = agentDir(locationSvc.directory, loc)
          const filePath = path.join(dir, `${slug}.md`)

          // Check if file exists
          const fileExists: boolean = yield* Effect.promise(async () => {
            try {
              await fsp.access(filePath)
              return true
            } catch {
              return false
            }
          })
          if (!fileExists) {
            throw new Error(`Agent "${slug}" not found`)
          }

          // Read existing file
          const existingRaw: string = yield* Effect.promise(() => fsp.readFile(filePath, "utf-8"))
          const existing = ConfigMarkdown.parse(existingRaw)

          // Build frontmatter
          const fm: Record<string, unknown> = {}
          if (ctx.payload.description) fm.description = ctx.payload.description
          if (ctx.payload.mode) fm.mode = ctx.payload.mode
          if (ctx.payload.model) fm.model = ctx.payload.model
          if (ctx.payload.temperature !== undefined) fm.temperature = ctx.payload.temperature
          if (ctx.payload.color) fm.color = ctx.payload.color
          if (ctx.payload.hidden !== undefined) fm.hidden = ctx.payload.hidden
          if (ctx.payload.disable !== undefined) fm.disable = ctx.payload.disable
          if (ctx.payload.permission && Object.keys(ctx.payload.permission).length > 0) {
            fm.permission = ctx.payload.permission
          }

          // Preserve existing body if no new prompt provided
          const body = ctx.payload.prompt !== undefined
            ? ctx.payload.prompt
            : (existing.content as string).trim()
          const frontmatter = stringifyFrontmatter(fm)
          const markdown = frontmatter + "\n" + body + (body ? "\n" : "")

          // Write file
          yield* Effect.promise(() => fsp.writeFile(filePath, markdown, "utf-8"))

          return yield* response(
            Effect.succeed({ name: slug, path: filePath }),
          )
        }),
      )
      .handle(
        "agent.delete",
        Effect.fn("AgentHandler.delete")(function* (ctx) {
          const fsp = yield* Effect.promise(() => import("fs/promises"))
          const slug = sanitizeSlug(ctx.params.id)
          if (BUILTIN_AGENTS.has(slug)) {
            throw new Error(`Cannot delete built-in agent: ${slug}`)
          }

          const locationSvc = yield* Location.Service
          const dir = agentDir(locationSvc.directory, ctx.query.agentLocation as "project" | "global")
          const filePath = path.join(dir, `${slug}.md`)

          // Check if file exists
          const fileExists: boolean = yield* Effect.promise(async () => {
            try {
              await fsp.access(filePath)
              return true
            } catch {
              return false
            }
          })
          if (!fileExists) {
            throw new Error(`Agent "${slug}" not found`)
          }

          // Delete file
          yield* Effect.promise(() => fsp.unlink(filePath))
        }),
      )
  }),
)
