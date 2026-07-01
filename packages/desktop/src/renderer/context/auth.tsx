import {
  createContext,
  createEffect,
  createResource,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import {
  REMOTE_SERVICE_SETTINGS_KEY,
  REMOTE_SERVICE_SETTINGS_STORAGE,
  remoteServiceBaseUrlFromSettings,
  remoteServiceUrl,
} from "@opencode-ai/app"
import { createMockToken, isMockAuthToken, verifyWithServer } from "./auth-verify"

const AUTH_STORE = "opencode.auth"
const AUTH_TOKEN_KEY = "token"
export { isMockAuthToken } from "./auth-verify"

export const authTokenRef = { current: "" }
const [authServerUrl, setAuthServerUrlSignal] = createSignal<string>()
const [remoteServiceBaseUrl, setRemoteServiceBaseUrlSignal] = createSignal<string>()

type AuthState = {
  ready: Accessor<boolean>
  authenticated: Accessor<boolean>
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
}

const AuthContext = createContext<AuthState>()

export function setAuthServerUrl(url: string | undefined) {
  setAuthServerUrlSignal(url)
}

export function setRemoteServiceBaseUrl(url: string | undefined) {
  setRemoteServiceBaseUrlSignal(url)
}

function getServerUrl() {
  const url = remoteServiceBaseUrl() ?? authServerUrl()
  if (!url) throw new Error("登录服务未准备好")
  return url
}

export function AuthProvider(props: ParentProps) {
  const [storedToken, { mutate }] = createResource(
    () => window.api.storeGet(AUTH_STORE, AUTH_TOKEN_KEY).then((v) => (typeof v === "string" ? v : null)),
    { initialValue: undefined as string | null | undefined },
  )
  const [storedRemoteServiceBaseUrl] = createResource(
    () =>
      window.api
        .storeGet(REMOTE_SERVICE_SETTINGS_STORAGE, REMOTE_SERVICE_SETTINGS_KEY)
        .then(remoteServiceBaseUrlFromSettings),
    { initialValue: undefined as string | undefined },
  )

  const [validating, setValidating] = createSignal(true)
  const [validatedToken, setValidatedToken] = createSignal<string>()
  let validatingToken: string | undefined

  createEffect(() => {
    const value = storedRemoteServiceBaseUrl()
    if (value) setRemoteServiceBaseUrl(value)
  })

  createEffect(() => {
    const token = storedToken()
    if (storedRemoteServiceBaseUrl.loading) return
    const baseUrl = remoteServiceBaseUrl() ?? authServerUrl()
    if (token === undefined) return // still loading

    if (token === null) {
      authTokenRef.current = ""
      setValidating(false)
      return
    }

    if (!baseUrl) return

    if (validatedToken() === token || validatingToken === token) return
    validatingToken = token

    // Verify existing token on startup
    verifyWithServer(baseUrl, token).then((result) => {
      if (storedToken() !== token) return
      validatingToken = undefined
      setValidatedToken(token)

      if (result === "valid" || result === "unreachable") {
        authTokenRef.current = token
      }
      if (result === "invalid") {
        void window.api.storeDelete(AUTH_STORE, AUTH_TOKEN_KEY)
        mutate(null)
        authTokenRef.current = ""
      }
      setValidating(false)
    })
  })

  async function loginWithCredentials(baseUrl: string, username: string, password: string) {
    const resp = await fetch(remoteServiceUrl(baseUrl, "/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).catch(() => undefined)
    if (!resp) {
      const token = createMockToken(username)
      authTokenRef.current = token
      await window.api.storeSet(AUTH_STORE, AUTH_TOKEN_KEY, token)
      mutate(token)
      return
    }
    if (!resp.ok) throw new Error(resp.status === 401 ? "用户名或密码错误" : "登录失败")
    const data = (await resp.json()) as { token: string }
    authTokenRef.current = data.token
    await window.api.storeSet(AUTH_STORE, AUTH_TOKEN_KEY, data.token)
    mutate(data.token)
  }

  const state: AuthState = {
    ready: () => !validating(),
    authenticated: () => !!storedToken() && !validating(),

    async login(username: string, password: string) {
      await loginWithCredentials(getServerUrl(), username, password)
    },

    async logout() {
      try {
        if (!isMockAuthToken(authTokenRef.current)) {
          await fetch(remoteServiceUrl(getServerUrl(), "/api/auth/logout"), {
            method: "POST",
            headers: { Authorization: `Bearer ${authTokenRef.current}` },
          })
        }
      } catch {
        // ignore network errors on logout
      }
      authTokenRef.current = ""
      await window.api.storeDelete(AUTH_STORE, AUTH_TOKEN_KEY)
      mutate(null)
    },
  }

  return <AuthContext.Provider value={state}>{props.children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
