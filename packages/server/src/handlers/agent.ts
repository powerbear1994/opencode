import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import path from "path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { mergeAgentFrontmatter, stringifyAgentFrontmatter, validateAgentID } from "./agent-file"

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function agentDir(dir: string, location: "project" | "global"): string {
  if (location === "global") {
    return path.join(Global.Path.config, "agents")
  }
  return path.join(dir, ".opencode", "agents")
}

function configAgentContent(id: string, item: NonNullable<Config.Info["agents"]>[string]) {
  const frontmatter = Object.fromEntries(Object.entries(item).filter(([key]) => key !== "system"))
  const body = item.system ?? ""
  return {
    name: id,
    content: JSON.stringify({ agents: { [id]: item } }, null, 2),
    frontmatter,
    body,
  }
}

function configScopeMatches(filepath: string, globalConfig: string, agentLocation: string) {
  const globalRelative = path.relative(path.resolve(globalConfig), path.resolve(filepath))
  const isGlobal = globalRelative === "" || (!globalRelative.startsWith("..") && !path.isAbsolute(globalRelative))
  return agentLocation === "global-config" ? isGlobal : !isGlobal
}

async function readOptionalAgentMarkdown(directory: string, id: string) {
  const fsp = await import("fs/promises")
  const files = [path.join(directory, "agent", `${id}.md`), path.join(directory, "agents", `${id}.md`)]
  const contents = await Promise.all(
    files.map(async (filePath) => {
      try {
        return { filePath, content: await fsp.readFile(filePath, "utf-8") }
      } catch {
        return undefined
      }
    }),
  )
  return contents.filter((item): item is { filePath: string; content: string } => item !== undefined)
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
          const agentLocation = ctx.query.agentLocation as string
          if (agentLocation === "project-config" || agentLocation === "global-config") {
            const global = yield* Global.Service
            const configs = yield* Config.Service.use((config) => config.entries())
            const candidates = yield* Effect.forEach(configs, (entry) =>
              Effect.gen(function* () {
                if (entry.type === "document") {
                  const item = entry.info.agents?.[id]
                  if (!entry.path || !item || !configScopeMatches(entry.path, global.config, agentLocation)) return []
                  return [{ ...configAgentContent(id, item), path: entry.path }]
                }
                if (!configScopeMatches(entry.path, global.config, agentLocation)) return []
                return yield* Effect.promise(() => readOptionalAgentMarkdown(entry.path, id)).pipe(
                  Effect.map((files) =>
                    files.map((file) => {
                      const parsed = ConfigMarkdown.parse(file.content)
                      return {
                        name: id,
                        path: file.filePath,
                        content: file.content,
                        frontmatter: parsed.data as Record<string, unknown>,
                        body: (parsed.content as string).trim(),
                      }
                    }),
                  ),
                )
              }),
            ).pipe(Effect.map((items) => items.flat()))
            const candidate = candidates.at(-1)
            if (!candidate) throw new Error(`Agent "${id}" not found`)
            return yield* response(
              Effect.succeed(candidate),
            )
          }

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
              path: filePath,
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
          validateAgentID(slug)

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
          yield* AgentV2.Service.use((agent) => agent.reload())

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
          yield* AgentV2.Service.use((agent) => agent.reload())

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
          yield* AgentV2.Service.use((agent) => agent.reload())
        }),
      )
  }),
)
