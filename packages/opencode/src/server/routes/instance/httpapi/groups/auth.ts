import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

export const AuthPaths = {
  login: "/api/auth/login",
  verify: "/api/auth/verify",
  logout: "/api/auth/logout",
} as const

const LoginPayload = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
})

const LoginSuccess = Schema.Struct({
  token: Schema.String,
})

const VerifySuccess = Schema.Struct({
  valid: Schema.Literal(true),
})

export const AuthApi = HttpApi.make("auth").add(
  HttpApiGroup.make("auth")
    .add(
      HttpApiEndpoint.post("login", AuthPaths.login, {
        payload: LoginPayload,
        success: described(LoginSuccess, "JWT auth token"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.login",
          summary: "User login",
          description: "Authenticate with username and password to receive a JWT token.",
        }),
      ),
      HttpApiEndpoint.get("verify", AuthPaths.verify, {
        success: described(VerifySuccess, "Token is valid"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.verify",
          summary: "Verify token",
          description: "Check whether the current Bearer JWT token is still valid.",
        }),
      ),
      HttpApiEndpoint.post("logout", AuthPaths.logout, {
        success: described(Schema.Void, "Logged out"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.logout",
          summary: "Logout",
          description: "End the client session. JWT tokens expire automatically.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "auth", description: "Authentication routes." })),
)
