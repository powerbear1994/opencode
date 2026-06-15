/**
 * Frontend utility for previewing agent markdown content.
 * The actual markdown parsing/writing is handled by the server.
 * This module provides helpers for local preview and display.
 */

/** Parse frontmatter + body from a markdown string (simple regex-based) */
export function parseMarkdownPreview(content: string): {
  frontmatter: Record<string, string>
  body: string
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const fmRaw = match[1]!
  const body = match[2]!.trim()

  const frontmatter: Record<string, string> = {}
  for (const line of fmRaw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()
    if (key) frontmatter[key] = value
  }

  return { frontmatter, body }
}

/** Format markdown for display preview */
export function formatMarkdownPreview(frontmatter: Record<string, string>, body: string): string {
  const fmLines = ["---"]
  for (const [key, value] of Object.entries(frontmatter)) {
    fmLines.push(`${key}: ${value}`)
  }
  fmLines.push("---")
  if (body) {
    fmLines.push("", body)
  }
  return fmLines.join("\n")
}
