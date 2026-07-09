import { describe, expect, test } from "bun:test"
import {
  normalizeRemoteServiceBaseUrl,
  remoteServiceBaseUrlFromSettings,
  remoteServiceUrl,
} from "./remote-service"

describe("remote service url helpers", () => {
  test("normalizes empty and basic urls", () => {
    expect(normalizeRemoteServiceBaseUrl("")).toBeUndefined()
    expect(normalizeRemoteServiceBaseUrl("service.example.test")).toBe("http://service.example.test")
    expect(normalizeRemoteServiceBaseUrl("https://service.example.test/root/")).toBe("https://service.example.test/root")
  })

  test("rejects unsupported protocols and invalid urls", () => {
    expect(normalizeRemoteServiceBaseUrl("file:///tmp/service")).toBeUndefined()
    expect(normalizeRemoteServiceBaseUrl("http://")).toBeUndefined()
  })

  test("joins relative api paths against the configured root", () => {
    expect(remoteServiceUrl("https://service.example.test/root", "/ai-user/tpLogin")).toBe(
      "https://service.example.test/root/ai-user/tpLogin",
    )
  })

  test("reads the remote service base url from persisted settings", () => {
    expect(
      remoteServiceBaseUrlFromSettings(
        JSON.stringify({
          remoteService: {
            baseUrl: "https://service.example.test/root/",
          },
        }),
      ),
    ).toBe("https://service.example.test/root")
  })
})
