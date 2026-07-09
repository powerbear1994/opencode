import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
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
  AgentGeneratePayload,
  ApiSkillManageError,
  ApiVcsApplyError,
  RuleCreatePayload,
  RuleWritePayload,
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
import { Provider, parseModel } from "@/provider/provider"
import { LLMEvent } from "@opencode-ai/llm"
import { MessageID, SessionID } from "@/session/schema"

const DEFAULT_SKILL_DIRECTORIES = ["references", "scripts", "assets"]

type RuleInfo = {
  id: string
  title: string
  path: string
  source: "project" | "global" | "instruction"
  kind: "agents" | "claude" | "config"
  exists: boolean
  active: boolean
  editable: boolean
  remote: boolean
  blockedBy?: string
  content?: string
}

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

function agentSegment(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
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

function normalizeSkillFilePath(file: string | undefined) {
  const value = file?.trim() || "SKILL.md"
  const normalized = value.split(path.sep).join("/")
  if (normalized.startsWith("/") || normalized.includes("\0")) return
  const resolved = path.posix.normalize(normalized)
  if (resolved === "." || resolved.startsWith("../") || resolved === "..") return
  return resolved
}

function skillPackageRoot(location: string) {
  return path.dirname(location)
}

function ruleTitle(rule: Pick<RuleInfo, "source" | "kind" | "path">) {
  if (rule.source === "project" && rule.kind === "agents") return "项目 AGENTS.md"
  if (rule.source === "project" && rule.kind === "claude") return "项目 CLAUDE.md"
  if (rule.source === "global" && rule.kind === "agents") return "全局 AGENTS.md"
  if (rule.source === "global" && rule.kind === "claude") return "全局 CLAUDE.md"
  return rule.path.startsWith("http://") || rule.path.startsWith("https://") ? "远程 instructions" : "额外 instructions"
}

function extractMarkdown(text: string) {
  const trimmed = text.trim()
  // Try to extract content from markdown code fences
  const fenceMatch = trimmed.match(/```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```/)
  if (fenceMatch) return fenceMatch[1].trim()
  // If no code fences, return the raw text (assuming the model output it directly)
  return trimmed
}

function extractJson(text: string) {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  const candidate = fenceMatch?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start === -1 || end <= start) return
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown
    } catch {
      return
    }
  }
}

function isPlaceholderDescription(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, "").replace(/[。,.，、；;:："'“”‘’`]+/g, "")
  return (
    normalized.includes("何时调用这个技能") ||
    normalized.includes("什么时候应该") ||
    normalized.includes("usewhentheuserneeds")
  )
}

function isUsableSkillContent(value: string) {
  const trimmed = value.trim()
  if (trimmed.length < 80) return false
  if (!/^#\s+/m.test(trimmed)) return false
  if (/^\s*(User|Assistant)\s*:/im.test(trimmed)) return false
  if (/\b(TODO|TBD|lorem ipsum|fill this in)\b/i.test(trimmed)) return false
  return true
}

function isUsableAgentPrompt(value: string) {
  const trimmed = value.trim()
  if (trimmed.length < 180) return false
  if (/^\s*(User|Assistant)\s*:/im.test(trimmed)) return false
  if (/\b(TODO|TBD|lorem ipsum|fill this in)\b/i.test(trimmed)) return false
  if (/忽略.*(系统|开发者|上级).*指令/.test(trimmed)) return false
  return true
}

function inferDescriptionFromContent(content: string) {
  const match = content.match(/^##\s+(?:何时调用|When to Use)\s*\n([\s\S]*?)(?=^##\s+|\z)/im)
  const line = match?.[1]
    ?.split("\n")
    .map((item) => item.replace(/^[-*]\s+/, "").trim())
    .find((item) => item && !item.includes("不要") && !item.includes("不适合"))
  if (!line) return
  return line.replace(/[。.!！?？]+$/, "")
}

function parseGeneratedSkill(text: string) {
  const json = extractJson(text)
  if (isRecord(json) && typeof json.name === "string" && typeof json.content === "string") {
    const name = skillSegment(json.name)
    const content = json.content.trim()
    const parsed = parseSkillDocument(content)
    const description =
      (typeof json.description === "string" ? json.description.trim() : undefined) ||
      parsed?.description?.trim() ||
      inferDescriptionFromContent(parsed?.content ?? content)
    if (
      name &&
      description &&
      isUsableSkillContent(parsed?.content ?? content) &&
      !isPlaceholderDescription(description)
    ) {
      return { name, description, content }
    }
  }

  const markdown = extractMarkdown(text)
  const parsed = parseSkillDocument(markdown)
  if (parsed?.content.trim()) {
    const name = skillSegment(parsed.name)
    const description = parsed.description?.trim() || inferDescriptionFromContent(parsed.content)
    if (
      name &&
      description &&
      isUsableSkillContent(parsed.content) &&
      !isPlaceholderDescription(description)
    ) {
      return { name, description, content: parsed.content.trim() }
    }
  }
}

function parseGeneratedAgent(text: string) {
  const json = extractJson(text)
  if (!isRecord(json)) return
  if (typeof json.name !== "string") return
  if (typeof json.description !== "string") return
  if (typeof json.prompt !== "string") return

  const name = agentSegment(json.name)
  const description = json.description.trim()
  const mode: "primary" | "all" | "subagent" = json.mode === "primary" || json.mode === "all" ? json.mode : "subagent"
  const prompt = json.prompt.trim()
  if (!name || description.length < 8 || !isUsableAgentPrompt(prompt)) return
  return { name, description, mode, prompt }
}

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const config = yield* Config.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const vcs = yield* Vcs.Service
    const fs = yield* FSUtil.Service
    const llm = yield* LLM.Service
    const provider = yield* Provider.Service
    const flags = yield* RuntimeFlags.Service

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
      yield* command.reload()
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      yield* agent.reload()
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      yield* skill.reload()
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

    const readRuleContent = Effect.fn("InstanceHttpApi.rule.readContent")(function* (rule: RuleInfo) {
      if (!rule.exists || rule.remote) return undefined
      return yield* fs.readFileStringSafe(rule.path).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const configInstructions = Effect.fn("InstanceHttpApi.rule.configInstructions")(function* () {
      const ctx = yield* InstanceState.context
      const cfg = yield* config.get()
      return yield* Effect.forEach(
        cfg.instructions ?? [],
        Effect.fnUntraced(function* (raw, index) {
          const remote = raw.startsWith("https://") || raw.startsWith("http://")
          if (remote) {
            return [{
              id: `instruction:${index}:${raw}`,
              title: ruleTitle({ source: "instruction", kind: "config", path: raw }),
              path: raw,
              source: "instruction" as const,
              kind: "config" as const,
              exists: true,
              active: true,
              editable: false,
              remote: true,
            }]
          }

          const instruction = raw.startsWith("~/") ? path.join(Global.Path.home, raw.slice(2)) : raw
          const matches = yield* (
            path.isAbsolute(instruction)
              ? fs.glob(path.basename(instruction), {
                  cwd: path.dirname(instruction),
                  absolute: true,
                  include: "file",
                })
              : fs.globUp(instruction, ctx.directory, ctx.worktree)
          ).pipe(Effect.catch(() => Effect.succeed([] as string[])))

          if (matches.length > 0) {
            return matches.map((item, itemIndex) => ({
              id: `instruction:${index}:${itemIndex}:${item}`,
              title: ruleTitle({ source: "instruction", kind: "config", path: item }),
              path: item,
              source: "instruction" as const,
              kind: "config" as const,
              exists: true,
              active: true,
              editable: true,
              remote: false,
            }))
          }

          return [{
            id: `instruction:${index}:${raw}`,
            title: ruleTitle({ source: "instruction", kind: "config", path: raw }),
            path: raw,
            source: "instruction" as const,
            kind: "config" as const,
            exists: false,
            active: false,
            editable: false,
            remote: false,
          }]
        }),
        { concurrency: 4 },
      ).pipe(Effect.map((groups) => groups.flat()))
    })

    const getRuleList = Effect.fn("InstanceHttpApi.rule")(function* () {
      const ctx = yield* InstanceState.context
      const globalAgents = path.join(Global.Path.config, "AGENTS.md")
      const globalClaude = path.join(Global.Path.home, ".claude", "CLAUDE.md")
      const projectAgentsMatches = yield* fs.findUp("AGENTS.md", ctx.directory, ctx.worktree).pipe(
        Effect.catch(() => Effect.succeed([] as string[])),
      )
      const projectClaudeMatches = flags.disableClaudeCodePrompt
        ? []
        : yield* fs.findUp("CLAUDE.md", ctx.directory, ctx.worktree).pipe(
            Effect.catch(() => Effect.succeed([] as string[])),
          )
      const projectAgents = projectAgentsMatches[0] ?? path.join(ctx.directory, "AGENTS.md")
      const projectClaude = projectClaudeMatches[0] ?? path.join(ctx.directory, "CLAUDE.md")
      const globalAgentsExists = yield* fs.existsSafe(globalAgents)
      const globalClaudeExists = !flags.disableClaudeCodePrompt && (yield* fs.existsSafe(globalClaude))
      const projectAgentsExists = projectAgentsMatches.length > 0
      const projectClaudeExists = projectClaudeMatches.length > 0
      const rules: RuleInfo[] = [
        {
          id: "project-agents",
          title: "项目 AGENTS.md",
          path: projectAgents,
          source: "project",
          kind: "agents",
          exists: projectAgentsExists,
          active: projectAgentsExists,
          editable: true,
          remote: false,
        },
        {
          id: "project-claude",
          title: "项目 CLAUDE.md",
          path: projectClaude,
          source: "project",
          kind: "claude",
          exists: projectClaudeExists,
          active: !projectAgentsExists && projectClaudeExists,
          editable: !flags.disableClaudeCodePrompt,
          remote: false,
          blockedBy: projectAgentsExists ? "项目 AGENTS.md" : undefined,
        },
        {
          id: "global-agents",
          title: "全局 AGENTS.md",
          path: globalAgents,
          source: "global",
          kind: "agents",
          exists: globalAgentsExists,
          active: globalAgentsExists,
          editable: true,
          remote: false,
        },
        {
          id: "global-claude",
          title: "全局 CLAUDE.md",
          path: globalClaude,
          source: "global",
          kind: "claude",
          exists: globalClaudeExists,
          active: !globalAgentsExists && globalClaudeExists,
          editable: !flags.disableClaudeCodePrompt,
          remote: false,
          blockedBy: globalAgentsExists ? "全局 AGENTS.md" : undefined,
        },
        ...(yield* configInstructions()),
      ]

      return yield* Effect.forEach(
        rules.filter((rule) => rule.exists),
        Effect.fnUntraced(function* (rule) {
          const content = yield* readRuleContent(rule)
          return content === undefined ? rule : { ...rule, content }
        }),
        { concurrency: 8 },
      )
    })

    const findRule = Effect.fn("InstanceHttpApi.rule.find")(function* (id: string) {
      const found = (yield* getRuleList()).find((rule) => rule.id === id)
      if (!found) return yield* Effect.fail(skillError("missing", "Rule file was not found."))
      return found
    })

    const resolveGenerateModel = Effect.fn("InstanceHttpApi.generate.resolveModel")(function* (
      selection?: { providerID: string; modelID: string },
    ) {
      const selected = selection
        ? parseModel(`${selection.providerID}/${selection.modelID}`)
        : yield* provider.defaultModel().pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!selected) return yield* Effect.fail(skillError("invalid", "No AI model is configured."))
      return yield* provider.getModel(selected.providerID, selected.modelID).pipe(
        Effect.catchCause(() =>
          Effect.fail(skillError("invalid", "Failed to find an available AI model.")),
        ),
      )
    })

    const getRuleFile = Effect.fn("InstanceHttpApi.ruleFile")(function* (ctx: { query: { id: string } }) {
      const rule = yield* findRule(ctx.query.id)
      if (!rule.exists) return yield* Effect.fail(skillError("missing", "Rule file does not exist yet."))
      if (rule.remote) return yield* Effect.fail(skillError("readonly", "Remote rule files are read-only."))
      const content = yield* readRuleContent(rule)
      if (content === undefined) return yield* Effect.fail(skillError("missing", "Rule file could not be read."))
      return {
        id: rule.id,
        title: rule.title,
        path: rule.path,
        content,
        editable: rule.editable,
      }
    })

    const reloadRule = Effect.fn("InstanceHttpApi.rule.reload")(function* (id: string) {
      const found = (yield* getRuleList()).find((rule) => rule.id === id)
      if (!found) return yield* Effect.fail(skillError("missing", "Rule file was not found."))
      return found
    })

    const createRule = Effect.fn("InstanceHttpApi.ruleCreate")(function* (ctx: {
      payload: typeof RuleCreatePayload.Type
    }) {
      const instance = yield* InstanceState.context
      const target = ctx.payload.source === "project"
        ? path.join(instance.directory, "AGENTS.md")
        : path.join(Global.Path.config, "AGENTS.md")
      if (yield* fs.existsSafe(target)) {
        return yield* Effect.fail(skillError("conflict", "AGENTS.md already exists at that location."))
      }
      yield* fs.writeWithDirs(target, ctx.payload.content).pipe(
        Effect.mapError(() => skillError("invalid", "Rule file could not be created.")),
      )
      return yield* reloadRule(ctx.payload.source === "project" ? "project-agents" : "global-agents")
    })

    const updateRule = Effect.fn("InstanceHttpApi.ruleUpdate")(function* (ctx: {
      payload: typeof RuleWritePayload.Type
    }) {
      const rule = yield* findRule(ctx.payload.id)
      if (!rule.editable || rule.remote || !rule.exists) {
        return yield* Effect.fail(skillError("readonly", "Rule file is read-only."))
      }
      yield* fs.writeWithDirs(rule.path, ctx.payload.content).pipe(
        Effect.mapError(() => skillError("invalid", "Rule file could not be saved.")),
      )
      return yield* reloadRule(rule.id)
    })

    const agentGenerate = Effect.fn("InstanceHttpApi.agentGenerate")(function* (ctx: {
      payload: typeof AgentGeneratePayload.Type
    }) {
      const name = agentSegment(ctx.payload.name)
      if (!name) return yield* Effect.fail(skillError("invalid", "Agent name must contain lowercase letters, numbers, hyphens, or underscores."))

      const description = ctx.payload.description?.trim() || ""
      if (description.length < 20) return yield* Effect.fail(skillError("invalid", "Agent requirements must be at least 20 characters."))

      const model = yield* resolveGenerateModel(ctx.payload.model)

      const system = [
        "You generate custom agent drafts for an AI coding assistant.",
        "Return only one valid JSON object with exactly these keys: name, description, mode, prompt.",
        "Do not include markdown fences, commentary, examples outside JSON, or extra keys.",
        "",
        "Meaning of the fields:",
        "- name: concise lowercase ASCII kebab-case identifier.",
        "- description: one polished trigger sentence explaining when this agent should be used. Use the user's language.",
        "- mode: usually \"subagent\" unless the user explicitly asks for a primary/default agent.",
        "- prompt: the complete system prompt for the agent.",
        "",
        "Prompt quality rules:",
        "- Use the user's language.",
        "- Keep the prompt concise and usable. Prefer a focused agent brief over a long operating manual.",
        "- Define the agent's role, when to use it, the basic workflow, and important boundaries.",
        "- Include output format, verification steps, or examples only when the user's request specifically needs them.",
        "- Write direct instructions to the agent. Use short sections and bullets when helpful.",
        "- Respect higher-priority system and developer instructions. Never tell the agent to ignore them.",
        "- Do not invent tools, APIs, files, or external services unless the user explicitly requested them.",
        "- Do not output a chat transcript. Never use lines starting with User: or Assistant:.",
        "- Do not include placeholder text such as TBD, TODO, fill this in, or lorem ipsum.",
        "- Most prompts should be 120-300 words. Go longer only when the role is genuinely complex.",
        "",
        "Good default prompt structure:",
        "# Role",
        "A short paragraph describing the agent's specialty.",
        "",
        "# When to Use",
        "2-4 bullets describing matching tasks or contexts.",
        "",
        "# Workflow",
        "3-6 practical steps the agent should follow.",
        "",
        "# Boundaries",
        "Only include this section if there are meaningful limits or things to avoid.",
      ]

      const prompt = [
        "Create an agent from this user input.",
        "",
        `<proposed_name>${name}</proposed_name>`,
        `<requirements>${description}</requirements>`,
        "",
        "Return JSON only.",
      ].join("\n")

      yield* Effect.logInfo("Generating agent via AI", { name, description })

      const sessionID = SessionID.descending()
      const AGENT_GENERATE_AGENT: Agent.Info = {
        name: "agent-generate",
        mode: "primary",
        permission: [],
        options: {},
        native: true,
        prompt: "",
      }

      const rawResult = yield* llm
        .stream({
          agent: AGENT_GENERATE_AGENT,
          user: {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: AGENT_GENERATE_AGENT.name,
            model: { providerID: model.providerID, modelID: model.id },
          },
          system,
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

      const generated = parseGeneratedAgent(rawResult)
      if (!generated) {
        yield* Effect.logWarning("AI returned invalid agent content", { name, preview: rawResult.slice(0, 200) })
        return yield* Effect.fail(skillError("invalid", "AI returned invalid agent content. Try a more specific description."))
      }

      yield* Effect.logInfo("Agent content generated", { name: generated.name, length: generated.prompt.length })
      return generated
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

    const getSkillPackageFiles = Effect.fn("InstanceHttpApi.skill.files")(function* (location: string) {
      if (location === "<built-in>") return [{ path: "SKILL.md", type: "file" as const }]
      const root = skillPackageRoot(location)
      const matches = yield* fs.glob("**/*", { cwd: root, include: "file", dot: true }).pipe(
        Effect.catch(() => Effect.succeed(["SKILL.md"])),
      )
      return [...new Set(["SKILL.md", ...matches.map((item) => item.split(path.sep).join("/"))])]
        .filter((item) => item !== "." && !item.startsWith("../"))
        .toSorted((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b)))
        .map((item) => ({ path: item, type: "file" as const }))
    })

    const getSkillFile = Effect.fn("InstanceHttpApi.skillFile")(function* (ctx: { query: { location: string; file?: string } }) {
      const found = yield* findSkillByLocation(ctx.query.location)
      const file = normalizeSkillFilePath(ctx.query.file)
      if (!file) return yield* Effect.fail(skillError("invalid", "Skill file path is invalid."))
      const files = yield* getSkillPackageFiles(found.location)
      const fallback = {
        content: skillDocument({
          name: found.name,
          description: found.description,
          content: found.content,
        }),
        editable: false,
        path: "SKILL.md",
        files,
      }
      if (found.location === "<built-in>") {
        return fallback
      }

      const root = skillPackageRoot(found.location)
      const target = path.resolve(root, file)
      if (!FSUtil.contains(root, target)) return yield* Effect.fail(skillError("invalid", "Skill file path is invalid."))

      const content = yield* fs.readFileStringSafe(target).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (content === undefined) return fallback

      return { content, editable: true, path: file, files }
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

      const root = skillPackageRoot(target)
      for (const dir of DEFAULT_SKILL_DIRECTORIES) {
        yield* fs.ensureDir(path.join(root, dir)).pipe(
          Effect.mapError(() => skillError("invalid", "Skill directory could not be created.")),
        )
      }
      for (const item of ctx.payload.files ?? []) {
        const file = normalizeSkillFilePath(item.path)
        if (!file || file === "SKILL.md") continue
        const extraTarget = path.resolve(root, file)
        if (!FSUtil.contains(root, extraTarget)) {
          return yield* Effect.fail(skillError("invalid", "Skill file path is invalid."))
        }
        yield* fs.writeWithDirs(extraTarget, item.content).pipe(
          Effect.mapError(() => skillError("invalid", "Skill file could not be created.")),
        )
      }

      return yield* reloadAndFind(target, parsed)
    })

    const updateSkill = Effect.fn("InstanceHttpApi.skillUpdate")(function* (ctx: {
      payload: typeof SkillWritePayload.Type
    }) {
      const found = yield* findEditableSkill(ctx.payload.location)
      const file = normalizeSkillFilePath(ctx.payload.file)
      if (!file) return yield* Effect.fail(skillError("invalid", "Skill file path is invalid."))
      const root = skillPackageRoot(found.location)
      const target = path.resolve(root, file)
      if (!FSUtil.contains(root, target)) return yield* Effect.fail(skillError("invalid", "Skill file path is invalid."))

      if (file === "SKILL.md") {
        const parsed = parseSkillDocument(ctx.payload.content)
        if (!parsed) return yield* Effect.fail(skillError("invalid", "Skill markdown must include name frontmatter."))

        yield* fs.writeWithDirs(found.location, ctx.payload.content).pipe(
          Effect.mapError(() => skillError("invalid", "Skill file could not be saved.")),
        )

        return yield* reloadAndFind(found.location, parsed)
      }

      yield* fs.writeWithDirs(target, ctx.payload.content).pipe(
        Effect.mapError(() => skillError("invalid", "Skill file could not be saved.")),
      )

      return found
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

      const model = yield* resolveGenerateModel(ctx.payload.model)

      const system = [
        "You generate SKILL.md drafts for an AI coding assistant.",
        "Return only one valid JSON object with exactly these keys: name, description, content.",
        "Do not include markdown fences, commentary, examples outside JSON, or extra keys.",
        "Do not copy literal placeholder text from the instructions.",
        "",
        "Meaning of the fields:",
        "- name: the skill identifier, concise lowercase ASCII kebab-case.",
        "- description: when this skill should be loaded. It is a polished trigger sentence, not the user's raw request.",
        "- content: the Markdown body of the skill. It must not contain YAML frontmatter, name metadata, or description metadata.",
        "",
        "Quality rules:",
        "- Generate a usable skill based on the user's requirements.",
        "- Use the user's language for description and content.",
        "- The description must explain when to load the skill in one concise trigger sentence.",
        "- Keep the skill simple and practical. Prefer a compact guide over a comprehensive manual.",
        "- The content should tell the assistant what to do, in what order, and what to avoid when it matters.",
        "- Do not output a chat transcript. Never use lines starting with User: or Assistant:.",
        "- Do not invent external commands, APIs, tools, or files unless the user explicitly requested them.",
        "- Do not include placeholder text such as TBD, TODO, fill this in, lorem ipsum, or 什么时候应该加载这个技能.",
        "",
        "Content style:",
        "- Start with a single H1 title.",
        "- Add a short one-paragraph summary when helpful.",
        "- Use 2-4 Markdown sections only when they clarify the workflow. Do not force sections like examples, constraints, or output format unless the user asked for them.",
        "- A good default structure is: H1 title, a brief overview, then a short bullet list or numbered workflow.",
        "- Keep most skills around 120-300 words. Go longer only when the requested workflow truly needs it.",
        "- Put trigger guidance in the description field, not in a long 'when to use' body section.",
      ]
        .filter(Boolean)

      const prompt = [
        "Create a skill from this user input.",
        "",
        `<proposed_name>${name}</proposed_name>`,
        `<requirements>${description}</requirements>`,
        "",
        "Return JSON only.",
      ].join("\n")

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
          system,
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

      const generated = parseGeneratedSkill(rawResult)
      if (!generated) {
        yield* Effect.logWarning("AI returned empty content", { name, preview: rawResult.slice(0, 200) })
        return yield* Effect.fail(skillError("invalid", "AI returned invalid skill content. Try a more specific description."))
      }

      const document = skillDocument(generated)
      const parsed = parseSkillDocument(document)
      if (!parsed) {
        yield* Effect.logWarning("AI returned invalid skill markdown", { name, preview: document.slice(0, 200) })
        return yield* Effect.fail(skillError("invalid", "AI returned invalid SKILL.md content. Try a more specific description."))
      }

      yield* Effect.logInfo("Skill content generated", { name: parsed.name, length: document.length })
      return {
        name: parsed.name,
        description: generated.description,
        content: document,
      }
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
      .handle("agentGenerate", agentGenerate)
      .handle("rule", getRuleList)
      .handle("ruleFile", getRuleFile)
      .handle("ruleCreate", createRule)
      .handle("ruleUpdate", updateRule)
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
