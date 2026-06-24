import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { mergeAgentFrontmatter, stringifyAgentFrontmatter, validateAgentID } from "./agent-file"

describe("agent file helpers", () => {
  test("preserves unknown fields and complex permission rules", () => {
    expect(
      mergeAgentFrontmatter(
        {
          variant: "high",
          options: { reasoning: "high" },
          permission: {
            task: { "*": "allow", general: "deny" },
            read: "ask",
          },
        },
        {
          model: "",
          permission: { read: "allow" },
        },
      ),
    ).toEqual({
      variant: "high",
      options: { reasoning: "high" },
      permission: {
        task: { "*": "allow", general: "deny" },
        read: "allow",
      },
    })
  })

  test("rejects path traversal IDs", () => {
    expect(() => validateAgentID("../secret")).toThrow()
    expect(validateAgentID("requirement-agent")).toBe("requirement-agent")
  })

  test("round trips complex frontmatter", () => {
    const input = {
      variant: "high",
      tags: ["requirements", "analysis"],
      permission: {
        task: { "*": "allow", general: "deny" },
      },
    }

    expect(ConfigMarkdown.parse(`${stringifyAgentFrontmatter(input)}\nprompt\n`).data).toEqual(input)
  })
})
