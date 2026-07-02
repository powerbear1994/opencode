import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"

export function resolveFilePath(input: string, directory: string, worktree: string) {
  const raw = input.trim()
  const base = worktree === "/" ? directory : worktree
  const resolved = path.isAbsolute(raw)
    ? raw
    : path.win32.isAbsolute(raw)
      ? windowsPathToLocalProject(raw, base) ?? raw
      : path.resolve(directory, raw)
  return process.platform === "win32" ? FSUtil.normalizePath(resolved) : resolved
}

function windowsPathToLocalProject(input: string, base: string) {
  const parts = input.split(/[\\/]+/).filter(Boolean)
  const index = parts.findIndex((part) => part.toLowerCase() === path.basename(base).toLowerCase())
  if (index < 0) return
  return path.join(base, ...parts.slice(index + 1))
}
