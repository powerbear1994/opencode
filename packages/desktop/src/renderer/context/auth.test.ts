import { afterEach, describe, expect, test } from "bun:test"
import { verifyWithServer } from "./auth-verify"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("verifyWithServer", () => {
  test("accepts mock tokens without contacting the remote service", async () => {
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    await expect(verifyWithServer("https://example.com", "mock:123:user")).resolves.toBe("valid")
  })

  test("keeps tokens when the remote service is unreachable", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch

    await expect(verifyWithServer("https://example.com", "token")).resolves.toBe("unreachable")
  })

  test("invalidates tokens only on auth failures", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch

    await expect(verifyWithServer("https://example.com", "token")).resolves.toBe("invalid")
  })

  test("accepts tokens when verification succeeds", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch

    await expect(verifyWithServer("https://example.com", "token")).resolves.toBe("valid")
  })
})
