import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const AgentCreatePayload = Schema.Struct({
  name: Schema.String,
  location: Schema.Literals(["project", "global"]),
  description: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
  model: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
  disable: Schema.optional(Schema.Boolean),
  permission: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["allow", "ask", "deny"]))),
  prompt: Schema.optional(Schema.String),
})

const AgentUpdatePayload = Schema.Struct({
  location: Schema.Literals(["project", "global"]),
  description: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
  model: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
  disable: Schema.optional(Schema.Boolean),
  permission: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["allow", "ask", "deny"]))),
  prompt: Schema.optional(Schema.String),
})

const AgentFileQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
  agentLocation: Schema.Literals(["project", "global"]),
})

const AgentFileResponse = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  content: Schema.String,
  frontmatter: Schema.Record(Schema.String, Schema.Unknown),
  body: Schema.String,
})

export { AgentCreatePayload, AgentUpdatePayload, AgentFileResponse }

export const AgentGroup = HttpApiGroup.make("server.agent")
  .add(
    HttpApiEndpoint.get("agent.list", "/api/agent", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Agent.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.list",
          summary: "List agents",
          description: "Retrieve currently registered agents.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("agent.readFile", "/api/agent/:id", {
      params: { id: Schema.String },
      query: AgentFileQuery,
      success: Location.response(AgentFileResponse),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.read",
          summary: "Read agent file",
          description: "Read the raw markdown file for an agent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("agent.create", "/api/agent", {
      query: LocationQuery,
      payload: AgentCreatePayload,
      success: Location.response(Schema.Struct({ name: Schema.String, path: Schema.String })),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.create",
          summary: "Create agent",
          description: "Create a new custom agent file.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("agent.update", "/api/agent/:id", {
      params: { id: Schema.String },
      query: LocationQuery,
      payload: AgentUpdatePayload,
      success: Location.response(Schema.Struct({ name: Schema.String, path: Schema.String })),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.update",
          summary: "Update agent",
          description: "Update an existing custom agent file.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("agent.delete", "/api/agent/:id", {
      params: { id: Schema.String },
      query: AgentFileQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.delete",
          summary: "Delete agent",
          description: "Delete a custom agent file.",
        }),
      ),
  )
