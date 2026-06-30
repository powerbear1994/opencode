import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { AuthPaths } from "../../src/server/routes/instance/httpapi/groups/auth"
import { authHandlers } from "../../src/server/routes/instance/httpapi/handlers/auth"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([authHandlers, controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(Installation.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(ServerAuth.Config.layer({ password: Option.some("secret"), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("auth HttpApi", () => {
  it.live("logs in with mock credentials and verifies the returned token", () =>
    Effect.gen(function* () {
      const login = yield* HttpClientRequest.post(AuthPaths.login).pipe(
        HttpClientRequest.setBody(HttpBody.jsonUnsafe({ username: "admin", password: "opencode" })),
        HttpClient.execute,
      )

      expect(login.status).toBe(200)
      const body = (yield* login.json) as { token: string }
      expect(body.token.length).toBeGreaterThan(0)

      const verify = yield* HttpClientRequest.get(AuthPaths.verify).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${body.token}`),
        HttpClient.execute,
      )

      expect(verify.status).toBe(200)
      expect(yield* verify.json).toEqual({ valid: true })
    }),
  )

  it.live("rejects invalid mock credentials", () =>
    Effect.gen(function* () {
      const login = yield* HttpClientRequest.post(AuthPaths.login).pipe(
        HttpClientRequest.setBody(HttpBody.jsonUnsafe({ username: "admin", password: "wrong" })),
        HttpClient.execute,
      )

      expect(login.status).toBe(401)
    }),
  )
})
