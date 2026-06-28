import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ApiSkillManageError,
  ApiVcsApplyError,
  SkillCreatePayload,
  SkillDeletePayload,
  SkillGeneratePayload,
  SkillWritePayload,
} from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"
import { isRecord } from "@/util/record"
import path from "path"
import { rm } from "fs/promises"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { LLMEvent } from "@opencode-ai/llm"
import { MessageID, SessionID } from "@/session/schema"

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

function extractMarkdown(text: string) {
  const trimmed = text.trim()
  // Try to extract content from markdown code fences
  const fenceMatch = trimmed.match(/```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```/)
  if (fenceMatch) return fenceMatch[1].trim()
  // If no code fences, return the raw text (assuming the model output it directly)
  return trimmed
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
    const llm = yield* LLM.Service
    const provider = yield* Provider.Service

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

    const skillGenerate = Effect.fn("InstanceHttpApi.skillGenerate")(function* (ctx: {
      payload: typeof SkillGeneratePayload.Type
    }) {
      const name = ctx.payload.name.trim()
      if (!name) return yield* Effect.fail(skillError("invalid", "Skill name is required."))

      const description = ctx.payload.description?.trim() || ""

      const fallback = yield* provider.defaultModel().pipe(
        Effect.catchCause(() => Effect.succeed(undefined)),
      )
      if (!fallback) return yield* Effect.fail(skillError("invalid", "No AI model is configured."))

      const model =
        (yield* provider.getSmallModel(fallback.providerID)) ??
        (yield* provider.getModel(fallback.providerID, fallback.modelID).pipe(
          Effect.catchCause(() =>
            Effect.fail(skillError("invalid", "Failed to find an available AI model.")),
          ),
        ))

      const prompt = [
        "Write a SKILL.md file for the following skill. Output ONLY the file content, nothing else.",
        "",
        `Skill name: ${name}`,
        description ? `What it does: ${description}` : "",
        "",
        "Rules:",
        "- Do NOT search for existing files, examples, or references.",
        "- Do NOT use any tools.",
        "- Do NOT write any introduction, explanation, or commentary.",
        "- Output the raw SKILL.md content directly, starting with the first --- line.",
        "",
        "The output must be valid markdown with YAML frontmatter:",
        "---",
        `name: ${name}`,
        ...(description ? [`description: ${description}`] : [`description: Use when the user asks about ${name}.`]),
        "---",
        "",
        `# ${name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
        "",
        "## When to Use",
        "Describe when this skill should be triggered — what the user might say or ask.",
        "",
        "## Instructions",
        "Step-by-step guidance for the AI assistant on how to handle this task.",
        "",
        "## Examples",
        "Provide 1-2 concrete examples of how this skill should be applied.",
      ]
        .filter(Boolean)
        .join("\n")

      yield* Effect.logInfo("Generating skill via AI", { name, description })

      const sessionID = SessionID.descending()

      const SKILL_GENERATE_AGENT: Agent.Info = {
        name: "skill-generate",
        mode: "primary",
        permission: [],
        options: {},
        native: true,
        prompt: "",
      }

      const rawResult = yield* llm
        .stream({
          agent: SKILL_GENERATE_AGENT,
          user: {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: SKILL_GENERATE_AGENT.name,
            model: { providerID: model.providerID, modelID: model.id },
          },
          system: [],
          small: true,
          tools: {},
          model,
          sessionID,
          retries: 2,
          messages: [{ role: "user", content: prompt }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
          Effect.catchCause(() =>
            Effect.fail(
              skillError("invalid", "AI call failed. Check server logs for details."),
            ),
          ),
        )

      const content = extractMarkdown(rawResult)
      if (!content) {
        yield* Effect.logWarning("AI returned empty content", { name, preview: rawResult.slice(0, 200) })
        return yield* Effect.fail(skillError("invalid", "AI returned empty content. Try a more specific description."))
      }

      yield* Effect.logInfo("Skill content generated", { name, length: content.length })
      return { content }
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
      .handle("skillGenerate", skillGenerate)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
  }),
)
