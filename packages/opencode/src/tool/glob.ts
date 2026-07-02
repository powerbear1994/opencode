import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
})

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          const search = yield* resolveSearchPath(params.path, ins.directory, ins.worktree, fs)
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: false,
            kind: "directory",
          })

          const limit = 100
          const files = yield* ripgrep.glob({ cwd: search, pattern: params.pattern, limit })
          const truncated = files.length === limit

          const output = []
          if (files.length === 0) output.push("No files found")
          if (files.length > 0) {
            output.push(...files.map((file) => path.resolve(search, file.path)))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function resolveSearchPath(input: string | undefined, directory: string, worktree: string, fs: FSUtil.Interface) {
  return Effect.gen(function* () {
    const candidates = searchPathCandidates(input, directory, worktree)
    for (const candidate of candidates) {
      const info = yield* fs.stat(candidate).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (info?.type === "File") throw new Error(`glob path must be a directory: ${candidate}`)
      if (info?.type === "Directory") return candidate
    }
    throw new Error(`glob path does not exist or is not accessible: ${candidates[0] ?? directory}`)
  })
}

function searchPathCandidates(input: string | undefined, directory: string, worktree: string) {
  const raw = input?.trim()
  if (!raw || raw === "undefined" || raw === "null") return [directory]
  if (path.isAbsolute(raw)) return [raw]
  if (!path.win32.isAbsolute(raw)) return [path.resolve(directory, raw)]

  return [
    windowsPathToWsl(raw),
    sameLeaf(raw, worktree) ? worktree : undefined,
    sameLeaf(raw, directory) ? directory : undefined,
    raw,
  ].filter((item): item is string => Boolean(item))
}

function windowsPathToWsl(input: string) {
  const match = /^(?<drive>[A-Za-z]):[\\/](?<rest>.*)$/.exec(input)
  if (!match?.groups) return input
  return path.join("/mnt", match.groups.drive.toLowerCase(), ...match.groups.rest.split(/[\\/]+/).filter(Boolean))
}

function sameLeaf(input: string, local: string) {
  return path.win32.basename(input) === path.basename(local)
}
