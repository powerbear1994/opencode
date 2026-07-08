import { describe, expect, test } from "bun:test"
import { requirementDocuments, requirementMetadataPath } from "./requirementProjectStore"

describe("requirementProjectStore paths", () => {
  test("stores generated requirement metadata under docs", () => {
    expect(requirementMetadataPath("#abc/../def")).toBe("docs/requirements/#abc-.-def.json")
  })

  test("keeps workflow artifacts under docs", () => {
    expect(requirementDocuments("#abc").development).toBe("docs/ai-workflow/#abc/03-development.md")
  })
})
