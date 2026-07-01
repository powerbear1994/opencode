const MOCK_TOKEN_PREFIX = "mock:"

function remoteServiceUrl(baseUrl: string, path: string) {
  return new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString()
}

export type VerifyResult = "valid" | "invalid" | "unreachable"

export function isMockAuthToken(token: string | undefined) {
  return token?.startsWith(MOCK_TOKEN_PREFIX) === true
}

export function createMockToken(username: string) {
  return `${MOCK_TOKEN_PREFIX}${Date.now()}:${encodeURIComponent(username.trim() || "mock")}`
}

export async function verifyWithServer(baseUrl: string, token: string): Promise<VerifyResult> {
  if (isMockAuthToken(token)) return "valid"
  try {
    const resp = await fetch(remoteServiceUrl(baseUrl, "/api/auth/verify"), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) return "valid"
    if (resp.status === 401 || resp.status === 403) return "invalid"
    return "unreachable"
  } catch {
    return "unreachable"
  }
}
