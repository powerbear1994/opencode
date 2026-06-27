import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ApiSkillManageError,
  ApiVcsApplyError,
  SkillCreatePayload,
  SkillDeletePayload,
  SkillWritePayload,
} from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"
import { isRecord } from "@/util/record"
import path from "path"
import { rm } from "fs/promises"
import { FSUtil } from "@opencode-ai/core/fs-util"

function skillDocument(input: { name: string; description?: string; content: string }) {
  if (parseSkillDocument(input.content)) return input.content
  return [
    "---",
    `name: ${JSON.stringify(input.name)}`,
    ...(input.description ? [`description: ${JSON.stringify(input.description)}`] : []),
    "---",
    "",
    input.content,
  ].join("\n")
}

function skillSegment(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) return
  return slug
}

function parseSkillDocument(content: string) {
  const parsed = ConfigMarkdown.parseOption(content)
  if (!parsed) return
  if (!isRecord(parsed.data) || typeof parsed.data.name !== "string" || parsed.data.name.trim() === "") return
  if (parsed.data.description !== undefined && typeof parsed.data.description !== "string") return
  return {
    name: parsed.data.name,
    description: parsed.data.description,
    content: parsed.content,
  }
}

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const vcs = yield* Vcs.Service
    const fs = yield* FSUtil.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
        concurrency: "unbounded",
      })
      return { branch, default_branch }
    })

    const getVcsStatus = Effect.fn("InstanceHttpApi.vcsStatus")(function* () {
      return yield* vcs.status()
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: {
      query: { mode: Vcs.Mode; context?: number }
    }) {
      return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
    })

    const getVcsDiffRaw = Effect.fn("InstanceHttpApi.vcsDiffRaw")(function* () {
      return yield* vcs.diffRaw()
    })

    const applyVcs = Effect.fn("InstanceHttpApi.vcsApply")(function* (ctx: { payload: Vcs.ApplyInput }) {
      return yield* vcs.apply(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsApplyError({
              name: "VcsApplyError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      return yield* skill.all()
    })

    const skillError = (reason: "conflict" | "invalid" | "missing" | "readonly", message: string) =>
      new ApiSkillManageError({
        name: "SkillManageError",
        data: {
          message,
          reason,
        },
      })

    const findSkillByLocation = Effect.fn("InstanceHttpApi.skill.findByLocation")(function* (location: string) {
      const found = (yield* skill.all()).find((item) => item.location === location)
      if (!found) return yield* Effect.fail(skillError("missing", "Skill was not found."))
      return found
    })

    const findEditableSkill = Effect.fn("InstanceHttpApi.skill.findEditable")(function* (location: string) {
      const found = yield* findSkillByLocation(location)
      if (found.location === "<built-in>") return yield* Effect.fail(skillError("readonly", "Built-in skills are read-only."))
      return found
    })

    const toSkillInfo = (location: string, parsed: NonNullable<ReturnType<typeof parseSkillDocument>>) => ({
      name: parsed.name,
      description: parsed.description,
      location,
      content: parsed.content,
    })

    const reloadAndFind = Effect.fn("InstanceHttpApi.skill.reloadAndFind")(function* (
      location: string,
      parsed: NonNullable<ReturnType<typeof parseSkillDocument>>,
    ) {
      yield* skill.reload()
      return (yield* skill.all()).find((item) => item.location === location) ?? toSkillInfo(location, parsed)
    })

    const getSkillFile = Effect.fn("InstanceHttpApi.skillFile")(function* (ctx: { query: { location: string } }) {
      const found = yield* findSkillByLocation(ctx.query.location)
      const fallback = {
        content: skillDocument({
          name: found.name,
          description: found.description,
          content: found.content,
        }),
        editable: false,
      }
      if (found.location === "<built-in>") {
        return fallback
      }

      const content = yield* fs.readFileStringSafe(found.location)
      if (content === undefined) return fallback

      return { content, editable: true }
    })

    const createSkill = Effect.fn("InstanceHttpApi.skillCreate")(function* (ctx: {
      payload: typeof SkillCreatePayload.Type
    }) {
      const segment = skillSegment(ctx.payload.name)
      if (!segment) return yield* Effect.fail(skillError("invalid", "Skill name must contain valid letters or numbers."))

      const instance = yield* InstanceState.context
      const target = path.join(
        ctx.payload.source === "project" ? instance.directory : path.join(Global.Path.home, ".claude", "skills"),
        ...(ctx.payload.source === "project" ? [".opencode", "skill", segment] : [segment]),
        "SKILL.md",
      )
      const content = skillDocument(ctx.payload)
      const parsed = parseSkillDocument(content)
      if (!parsed) return yield* Effect.fail(skillError("invalid", "Skill markdown must include name frontmatter."))

      if (yield* fs.existsSafe(target)) {
        return yield* Effect.fail(skillError("conflict", "A skill already exists at that path."))
      }

      yield* fs.writeWithDirs(target, content).pipe(
        Effect.mapError(() => skillError("invalid", "Skill file could not be created.")),
      )

      return yield* reloadAndFind(target, parsed)
    })

    const updateSkill = Effect.fn("InstanceHttpApi.skillUpdate")(function* (ctx: {
      payload: typeof SkillWritePayload.Type
    }) {
      const found = yield* findEditableSkill(ctx.payload.location)
      const parsed = parseSkillDocument(ctx.payload.content)
      if (!parsed) return yield* Effect.fail(skillError("invalid", "Skill markdown must include name frontmatter."))

      yield* fs.writeWithDirs(found.location, ctx.payload.content).pipe(
        Effect.mapError(() => skillError("invalid", "Skill file could not be saved.")),
      )

      return yield* reloadAndFind(found.location, parsed)
    })

    const deleteSkill = Effect.fn("InstanceHttpApi.skillDelete")(function* (ctx: {
      payload: typeof SkillDeletePayload.Type
    }) {
      const found = yield* findEditableSkill(ctx.payload.location)
      const owner = path.dirname(found.location)
      const container = path.basename(owner)
      const target = container === "skill" || container === "skills" ? found.location : owner

      yield* Effect.tryPromise({
        try: () => rm(target, { recursive: true, force: true }),
        catch: () => skillError("invalid", "Skill file could not be deleted."),
      })
      yield* skill.reload()
      return true
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return handlers
      .handle("dispose", dispose)
      .handle("path", getPath)
      .handle("vcs", getVcs)
      .handle("vcsStatus", getVcsStatus)
      .handle("vcsDiff", getVcsDiff)
      .handle("vcsDiffRaw", getVcsDiffRaw)
      .handle("vcsApply", applyVcs)
      .handle("command", getCommand)
      .handle("agent", getAgent)
      .handle("skill", getSkill)
      .handle("skillFile", getSkillFile)
      .handle("skillCreate", createSkill)
      .handle("skillUpdate", updateSkill)
      .handle("skillDelete", deleteSkill)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
  }),
)
