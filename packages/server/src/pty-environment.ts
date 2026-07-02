import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"

export interface Interface {
  readonly get: (input: { directory: string; cwd: string }) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerPtyEnvironment") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({}),
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

export const PtyEnvironment = {
  Service,
  layer,
  node,
}
