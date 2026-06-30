export const REMOTE_SERVICE_SETTINGS_STORAGE = "opencode.global.dat"
export const REMOTE_SERVICE_SETTINGS_KEY = "settings.v3"

export function normalizeRemoteServiceBaseUrl(input: string | undefined) {
  const trimmed = input?.trim()
  if (!trimmed) return
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  if (hasProtocol && !/^https?:\/\//i.test(trimmed)) return
  const withProtocol = hasProtocol ? trimmed : `http://${trimmed}`

  try {
    const url = new URL(withProtocol)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    return url.toString().replace(/\/+$/, "")
  } catch {
    return
  }
}

export function remoteServiceUrl(baseUrl: string | undefined, path: string) {
  const normalized = normalizeRemoteServiceBaseUrl(baseUrl)
  if (!normalized) throw new Error("Remote service URL is not configured")
  return new URL(path.replace(/^\/+/, ""), `${normalized}/`).toString()
}

export function remoteServiceBaseUrlFromSettings(raw: string | null | undefined) {
  if (!raw) return

  try {
    const parsed = JSON.parse(raw) as { remoteService?: { baseUrl?: unknown } }
    if (typeof parsed.remoteService?.baseUrl !== "string") return
    return normalizeRemoteServiceBaseUrl(parsed.remoteService.baseUrl)
  } catch {
    return
  }
}
