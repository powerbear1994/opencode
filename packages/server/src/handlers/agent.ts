import { AgentV2 } from "@opencode-ai/core/agent"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import path from "path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { mergeAgentFrontmatter, stringifyAgentFrontmatter, validateAgentID } from "./agent-file"

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function validateSlug(name: string): void {
  validateAgentID(name)
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
          return yield* response(AgentV2.Service.use((agent) => agent.all()))
        }),
      )
      .handle(
        "agent.readFile",
        Effect.fn("AgentHandler.readFile")(function* (ctx) {
          const id = validateAgentID(ctx.params.id)
          const location = yield* Location.Service
          const dir = agentDir(location.directory, ctx.query.agentLocation as "project" | "global")
          const filePath = path.join(dir, `${id}.md`)

          const content: string = yield* Effect.promise(() =>
            import("fs/promises").then((fsp) => fsp.readFile(filePath, "utf-8")),
          )

          const parsed = ConfigMarkdown.parse(content)
          return yield* response(
            Effect.succeed({
              name: id,
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

          const fm = mergeAgentFrontmatter({}, ctx.payload)

          const body = ctx.payload.prompt || ""
          const frontmatter = stringifyAgentFrontmatter(fm)
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
          const slug = validateAgentID(ctx.params.id)
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

          const fm = mergeAgentFrontmatter(existing.data as Record<string, unknown>, ctx.payload)

          // Preserve existing body if no new prompt provided
          const body = ctx.payload.prompt !== undefined
            ? ctx.payload.prompt
            : (existing.content as string).trim()
          const frontmatter = stringifyAgentFrontmatter(fm)
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
          const slug = validateAgentID(ctx.params.id)
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
