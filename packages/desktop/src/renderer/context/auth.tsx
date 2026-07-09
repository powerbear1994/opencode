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
  normalizeRemoteServiceBaseUrl,
  remoteServiceBaseUrlFromSettings,
  remoteServiceUrl,
} from "@opencode-ai/app"
import { verifyWithServer } from "./auth-verify"

const AUTH_STORE = "opencode.auth"
const AUTH_TOKEN_KEY = "token"
const AUTH_USERNAME_KEY = "username"
const AUTH_USER_CODE_KEY = "userCode"
const AUTH_REMOTE_SERVICE_BASE_URL_KEY = "remoteServiceBaseUrl"
const MOCK_USERNAME = "admin"
const MOCK_PASSWORD = "opencode"

export const authTokenRef = { current: "" }
const [authServer, setAuthServerSignal] = createSignal<{
  url: string
  username?: string | null
  password?: string | null
}>()
const [remoteServiceBaseUrl, setRemoteServiceBaseUrlSignal] = createSignal<string>()

type AuthState = {
  ready: Accessor<boolean>
  authenticated: Accessor<boolean>
  username: Accessor<string | undefined>
  userCode: Accessor<string | undefined>
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
}

type RemoteLoginResponse = {
  success?: boolean | string
  code?: string | null
  message?: string | null
  data?: {
    token?: string
    username?: string
    UserName?: string
    userCode?: string
  } | null
  detail?: unknown
}

const AuthContext = createContext<AuthState>()

export function setAuthServerUrl(url: string | undefined) {
  setAuthServerSignal(url ? { url } : undefined)
}

export function setAuthServerConnection(input: { url: string; username?: string | null; password?: string | null } | undefined) {
  setAuthServerSignal(input)
}

export function setRemoteServiceBaseUrl(url: string | undefined) {
  setRemoteServiceBaseUrlSignal(url)
  if (url) {
    void window.api.storeSet(AUTH_STORE, AUTH_REMOTE_SERVICE_BASE_URL_KEY, url)
    return
  }
  void window.api.storeDelete(AUTH_STORE, AUTH_REMOTE_SERVICE_BASE_URL_KEY)
}

export function AuthProvider(props: ParentProps) {
  const [storedToken, { mutate }] = createResource(
    () => window.api.storeGet(AUTH_STORE, AUTH_TOKEN_KEY).then((v) => (typeof v === "string" ? v : null)),
    { initialValue: undefined as string | null | undefined },
  )
  const [storedUsername, { mutate: mutateUsername }] = createResource(
    () => window.api.storeGet(AUTH_STORE, AUTH_USERNAME_KEY).then((v) => (typeof v === "string" ? v : null)),
    { initialValue: undefined as string | null | undefined },
  )
  const [storedUserCode, { mutate: mutateUserCode }] = createResource(
    () => window.api.storeGet(AUTH_STORE, AUTH_USER_CODE_KEY).then((v) => (typeof v === "string" ? v : null)),
    { initialValue: undefined as string | null | undefined },
  )
  const [storedRemoteServiceBaseUrl] = createResource(async () => {
    const [cached, globalSettings, defaultSettings] = await Promise.all([
      window.api.storeGet(AUTH_STORE, AUTH_REMOTE_SERVICE_BASE_URL_KEY),
      window.api.storeGet(REMOTE_SERVICE_SETTINGS_STORAGE, REMOTE_SERVICE_SETTINGS_KEY),
      window.api.storeGet("default.dat", REMOTE_SERVICE_SETTINGS_KEY),
    ])
    return (
      normalizeRemoteServiceBaseUrl(cached ?? undefined) ??
      remoteServiceBaseUrlFromSettings(globalSettings) ??
      remoteServiceBaseUrlFromSettings(defaultSettings)
    )
  })

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
    if (token === undefined) return // still loading

    if (token === null) {
      authTokenRef.current = ""
      setValidating(false)
      return
    }

    if (validatedToken() === token || validatingToken === token) return
    validatingToken = token

    verifyWithServer(remoteServiceBaseUrl() ?? authServer()?.url ?? "", token).then((result) => {
      if (storedToken() !== token) return
      validatingToken = undefined
      setValidatedToken(token)

      if (result === "valid" || result === "unreachable") {
        authTokenRef.current = token
      }
      if (result === "invalid") {
        void window.api.storeDelete(AUTH_STORE, AUTH_TOKEN_KEY)
        void window.api.storeDelete(AUTH_STORE, AUTH_USERNAME_KEY)
        void window.api.storeDelete(AUTH_STORE, AUTH_USER_CODE_KEY)
        mutate(null)
        mutateUsername(null)
        mutateUserCode(null)
        authTokenRef.current = ""
      }
      setValidating(false)
    })
  })

  async function allowMockLoginFromConfig() {
    const server = authServer()
    if (!server) return false
    const headers = new Headers()
    if (server.password) {
      headers.set("Authorization", `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`)
    }
    const resp = await fetch(remoteServiceUrl(server.url, "/global/config"), { headers }).catch(() => undefined)
    if (!resp?.ok) return false
    const cfg = (await resp.json().catch(() => undefined)) as { auth?: { allowMockLogin?: unknown } } | undefined
    return cfg?.auth?.allowMockLogin === true
  }

  async function loginWithCredentials(baseUrl: string | undefined, username: string, password: string) {
    if (username === MOCK_USERNAME && password === MOCK_PASSWORD && (await allowMockLoginFromConfig())) {
      const token = `mock:${Date.now()}:${encodeURIComponent(username)}`
      authTokenRef.current = token
      await window.api.storeSet(AUTH_STORE, AUTH_TOKEN_KEY, token)
      await window.api.storeSet(AUTH_STORE, AUTH_USERNAME_KEY, username)
      await window.api.storeSet(AUTH_STORE, AUTH_USER_CODE_KEY, username)
      mutate(token)
      mutateUsername(username)
      mutateUserCode(username)
      return
    }

    if (!baseUrl) throw new Error("登录服务未准备好")
    const resp = await fetch(remoteServiceUrl(baseUrl, "/ai-user/tpLogin"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: username, password }),
    }).catch(() => undefined)
    if (!resp) throw new Error("登录服务不可用")
    const data = (await resp.json().catch(() => undefined)) as RemoteLoginResponse | undefined
    if (!resp.ok) throw new Error(data?.message || (resp.status === 401 ? "用户名或密码错误" : "登录失败"))
    if (data?.success !== true && data?.success !== "true") throw new Error(data?.message || "登录失败")
    const token = data.data?.token
    if (!token) throw new Error("登录成功响应缺少 token")
    const remoteUsername = data.data?.UserName ?? data.data?.username ?? username
    const userCode = data.data?.userCode ?? ""
    authTokenRef.current = token
    await window.api.storeSet(AUTH_STORE, AUTH_TOKEN_KEY, token)
    await window.api.storeSet(AUTH_STORE, AUTH_USERNAME_KEY, remoteUsername)
    if (userCode) await window.api.storeSet(AUTH_STORE, AUTH_USER_CODE_KEY, userCode)
    if (!userCode) await window.api.storeDelete(AUTH_STORE, AUTH_USER_CODE_KEY)
    mutate(token)
    mutateUsername(remoteUsername)
    mutateUserCode(userCode || null)
  }

  const state: AuthState = {
    ready: () => !validating(),
    authenticated: () => !!storedToken() && !validating(),
    username: () => storedUsername() ?? undefined,
    userCode: () => storedUserCode() ?? undefined,

    async login(username: string, password: string) {
      await loginWithCredentials(remoteServiceBaseUrl(), username, password)
    },

    async logout() {
      authTokenRef.current = ""
      await window.api.storeDelete(AUTH_STORE, AUTH_TOKEN_KEY)
      await window.api.storeDelete(AUTH_STORE, AUTH_USERNAME_KEY)
      await window.api.storeDelete(AUTH_STORE, AUTH_USER_CODE_KEY)
      mutate(null)
      mutateUsername(null)
      mutateUserCode(null)
    },
  }

  return <AuthContext.Provider value={state}>{props.children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
