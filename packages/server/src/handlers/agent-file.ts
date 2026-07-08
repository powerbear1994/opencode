export function validateAgentID(name: string) {
  if (!name || !/^[a-z0-9._-]+$/.test(name)) {
    throw new Error("Agent name must only contain lowercase letters, numbers, dots, underscores, and hyphens")
  }
  return name
}

export function mergeAgentFrontmatter(
  existing: Record<string, unknown>,
  input: {
    description?: string
    mode?: "subagent" | "primary" | "all"
    model?: string
    steps?: number
    temperature?: number
    color?: string
    hidden?: boolean
    disable?: boolean
    permission?: Record<string, "allow" | "ask" | "deny">
  },
) {
  const next = { ...existing }

  if (input.description !== undefined) setOptional(next, "description", input.description)
  if (input.mode !== undefined) next.mode = input.mode
  if (input.model !== undefined) setOptional(next, "model", input.model)
  if (input.steps !== undefined) next.steps = input.steps
  if (input.temperature !== undefined) next.temperature = input.temperature
  if (input.color !== undefined) setOptional(next, "color", input.color)
  if (input.hidden !== undefined) next.hidden = input.hidden
  if (input.disable !== undefined) next.disable = input.disable
  if (input.permission !== undefined) {
    next.permission = {
      ...(typeof existing.permission === "object" && existing.permission !== null ? existing.permission : {}),
      ...input.permission,
    }
  }

  return next
}

export function stringifyAgentFrontmatter(data: Record<string, unknown>) {
  const lines = ["---"]
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    lines.push(`${yamlKey(key)}: ${stringifyYamlValue(value)}`)
  }
  lines.push("---")
  return lines.join("\n")
}

function setOptional(target: Record<string, unknown>, key: string, value: string) {
  if (value) {
    target[key] = value
    return
  }
  delete target[key]
}

function stringifyYamlValue(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent)
  if (value === null || value === undefined) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === "string") {
    if (/[:\n'"#&*!|>%@`{}[\]",\s]/.test(value) || value === "") return JSON.stringify(value)
    return value
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    return "\n" + entries.map(([key, item]) => `${pad}  ${yamlKey(key)}: ${stringifyYamlValue(item, indent + 1)}`).join("\n")
  }
  return String(value)
}

function yamlKey(value: string) {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value) ? value : JSON.stringify(value)
}
