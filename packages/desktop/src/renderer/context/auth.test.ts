import { verifyWithServer } from "./auth-verify"
import { describe, expect, test } from "bun:test"

describe("verifyWithServer", () => {
  test("accepts persisted remote service tokens without contacting the server", async () => {
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    await expect(verifyWithServer("https://example.com", "token")).resolves.toBe("valid")
  })

  test("rejects empty persisted tokens", async () => {
    await expect(verifyWithServer("https://example.com", "")).resolves.toBe("invalid")
  })
})
