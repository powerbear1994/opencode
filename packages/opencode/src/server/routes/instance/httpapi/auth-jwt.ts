import { Config as EffectConfig, Effect, Option } from "effect"
import { SignJWT, jwtVerify } from "jose"
import { ServerAuth } from "@/server/auth"

const JWT_ISSUER = "opencode"
const JWT_AUDIENCE = "opencode-desktop"

function getSigningKey(config: ServerAuth.Info): Effect.Effect<Uint8Array, Error> {
  return Effect.gen(function* () {
    const configuredSecret = yield* EffectConfig.string("OPENCODE_AUTH_JWT_SECRET").pipe(EffectConfig.option)
    const secret = Option.getOrUndefined(configuredSecret) ?? Option.getOrUndefined(config.password)
    if (!secret) return yield* Effect.fail(new Error("JWT signing secret is not configured"))
    return new TextEncoder().encode(secret)
  })
}

export function signToken(payload: { username: string }, config: ServerAuth.Info): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const key = yield* getSigningKey(config)
    return yield* Effect.tryPromise({
      try: () =>
        new SignJWT({ username: payload.username })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuer(JWT_ISSUER)
          .setAudience(JWT_AUDIENCE)
          .setIssuedAt()
          .setExpirationTime("24h")
          .sign(key),
      catch: (err) => new Error("Failed to sign JWT", { cause: err }),
    })
  })
}

export function verifyJwt(token: string, config: ServerAuth.Info): Effect.Effect<{ username: string }, Error> {
  return Effect.gen(function* () {
    const key = yield* getSigningKey(config)
    const result = yield* Effect.tryPromise({
      try: () => jwtVerify<{ username: string }>(token, key, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }),
      catch: (err) => new Error("Failed to verify JWT", { cause: err }),
    })
    if (typeof result.payload.username !== "string") return yield* Effect.fail(new Error("JWT username is invalid"))
    return { username: result.payload.username }
  })
}
