import { Config as EffectConfig, Effect, Option, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ServerAuth } from "@/server/auth"
import { signToken } from "../auth-jwt"

const LoginPayload = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
})

const RemoteLoginResponse = Schema.Struct({
  token: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  data: Schema.optional(
    Schema.Struct({
      token: Schema.optional(Schema.String),
      username: Schema.optional(Schema.String),
    }),
  ),
})

type AuthenticatedUser = {
  readonly username: string
  readonly upstreamToken?: string
}

class AuthenticationRejected extends Error {
  constructor() {
    super("Authentication rejected")
  }
}

function authSettings() {
  return EffectConfig.all({
    remoteUrl: EffectConfig.string("OPENCODE_AUTH_REMOTE_URL").pipe(EffectConfig.option),
    mockUsername: EffectConfig.string("OPENCODE_AUTH_MOCK_USERNAME").pipe(EffectConfig.withDefault("admin")),
    mockPassword: EffectConfig.string("OPENCODE_AUTH_MOCK_PASSWORD").pipe(EffectConfig.withDefault("opencode")),
  })
}

function authenticateUser(username: string, password: string) {
  return Effect.gen(function* () {
    const settings = yield* authSettings()
    const remoteUrl = Option.getOrUndefined(settings.remoteUrl)
    if (remoteUrl) return yield* authenticateRemote(remoteUrl, username, password)
    return yield* authenticateMock(username, password, settings.mockUsername, settings.mockPassword)
  })
}

function authenticateMock(username: string, password: string, mockUsername: string, mockPassword: string) {
  if (username === mockUsername && password === mockPassword) return Effect.succeed({ username })
  return Effect.fail(new AuthenticationRejected())
}

function authenticateRemote(remoteUrl: string, username: string, password: string) {
  return Effect.tryPromise({
    try: async (): Promise<AuthenticatedUser> => {
      const response = await fetch(remoteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) throw new AuthenticationRejected()
      const decoded = Schema.decodeUnknownSync(RemoteLoginResponse)(await response.json())
      const token = decoded.token ?? decoded.data?.token
      if (!token) throw new AuthenticationRejected()
      return {
        username: decoded.username ?? decoded.data?.username ?? username,
        upstreamToken: token,
      }
    },
    catch: (err) => (err instanceof Error ? err : new Error("Remote authentication failed")),
  })
}

export const authHandlers = HttpApiBuilder.group(RootHttpApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config

    const login = Effect.fn("AuthHttpApi.login")(function* (ctx: { payload: typeof LoginPayload.Type }) {
      const user = yield* authenticateUser(ctx.payload.username, ctx.payload.password).pipe(
        Effect.mapError(() => new HttpApiError.Unauthorized({})),
      )
      const token = yield* signToken({ username: user.username }, config).pipe(
        Effect.mapError(() => new HttpApiError.Unauthorized({})),
      )
      return { token }
    })

    const verify = Effect.fn("AuthHttpApi.verify")(function* () {
      return { valid: true as const }
    })

    const logout = Effect.fn("AuthHttpApi.logout")(function* () {})

    return handlers.handle("login", login).handle("verify", verify).handle("logout", logout)
  }),
)
