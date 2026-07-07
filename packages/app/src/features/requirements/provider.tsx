import { createSimpleContext } from "@opencode-ai/ui/context"
import { useServer } from "@/context/server"
import type { RequirementProvider } from "./types"
import {
  createRequirement,
  deleteRequirement,
  getRequirement,
  listRequirements,
} from "./services/requirementProjectStore"

export { buildDesignContent, buildDevelopmentContent, buildRawContent, buildTestContent } from "./services/promptBuilder"

function createProjectFileProvider(): RequirementProvider {
  const server = useServer()
  return {
    listRequirements(projectId) {
      return listRequirements({ server: server.current, project: projectId })
    },

    getRequirementDetail(projectId, id) {
      return getRequirement({ server: server.current, project: projectId, requirementId: id })
    },

    createRequirement(projectId, requirement) {
      return createRequirement({ server: server.current, project: projectId, requirement })
    },

    deleteRequirement(projectId, id) {
      return deleteRequirement({ server: server.current, project: projectId, requirementId: id })
    },
  }
}

export const {
  provider: RequirementsProvider,
  use: useRequirements,
} = createSimpleContext<RequirementProvider, Record<string, unknown>>({
  name: "Requirements",
  init: () => createProjectFileProvider(),
  gate: false,
})
