import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"
import { useServer } from "@/context/server"
import type { ServerConnection } from "@/context/server"
import {
  loadRequirementWorkflowRecords,
  normalizeWorkflow,
  updateRequirementWorkflow,
  type RequirementWorkflowRecord,
} from "./requirementProjectStore"

export type { RequirementWorkflowRecord }

let store: RequirementWorkflowRecord[] | undefined
let setStore: SetStoreFunction<RequirementWorkflowRecord[]> | undefined
const loadingProjects = new Set<string>()
const loadedProjects = new Set<string>()

function ensureStore() {
  if (!store || !setStore) {
    const [s, ss] = createStore<RequirementWorkflowRecord[]>([])
    store = s
    setStore = ss
  }
  return { records: store as RequirementWorkflowRecord[], setRecords: setStore }
}

function ensureProject(projectId: string, server?: ServerConnection.Any) {
  if (!projectId || loadingProjects.has(projectId) || loadedProjects.has(projectId)) return
  loadingProjects.add(projectId)
  void loadRequirementWorkflowRecords({ server, project: projectId })
    .then((records) => {
      const { records: current, setRecords } = ensureStore()
      const currentProjectRecords = current.filter((record) => record.projectId === projectId)
      const currentKeys = new Set(currentProjectRecords.map((record) => `${record.projectId}\u0000${record.requirementId}`))
      const next = [
        ...current.filter((record) => record.projectId !== projectId),
        ...currentProjectRecords,
        ...records.filter((record) => !currentKeys.has(`${record.projectId}\u0000${record.requirementId}`)),
      ]
      setRecords(reconcile(next))
      loadedProjects.add(projectId)
    })
    .finally(() => loadingProjects.delete(projectId))
}

function saveRecord(record: RequirementWorkflowRecord, server?: ServerConnection.Any) {
  void updateRequirementWorkflow({
    server,
    project: record.projectId,
    requirementId: record.requirementId,
    update: () => record,
  })
}

function updateRecord(
  records: RequirementWorkflowRecord[],
  projectId: string,
  requirementId: string,
  update: (record: RequirementWorkflowRecord) => RequirementWorkflowRecord,
) {
  const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
  const base = index >= 0 ? records[index] : normalizeWorkflow(undefined, projectId, requirementId)
  const record = update(base)
  const next = index >= 0
    ? records.map((item, i) => i === index ? record : item)
    : [...records, record]
  return { next, record }
}

export function useRequirementWorkflow() {
  const server = useServer()
  const { records, setRecords } = ensureStore()

  function getRecord(projectId: string, requirementId: string) {
    ensureProject(projectId, server.current)
    return records.find((record) => record.projectId === projectId && record.requirementId === requirementId)
  }

  function isLocked(projectId: string, requirementId: string) {
    return !!getRecord(projectId, requirementId)?.lockedAt
  }

  function isDesignLocked(projectId: string, requirementId: string) {
    return !!getRecord(projectId, requirementId)?.designLockedAt
  }

  function isDevelopmentLocked(projectId: string, requirementId: string) {
    return !!getRecord(projectId, requirementId)?.developmentLockedAt
  }

  function isTestLocked(projectId: string, requirementId: string) {
    return !!getRecord(projectId, requirementId)?.testLockedAt
  }

  function mutate(projectId: string, requirementId: string, update: (record: RequirementWorkflowRecord) => RequirementWorkflowRecord) {
    if (!projectId || !requirementId) return
    const result = updateRecord(records, projectId, requirementId, update)
    setRecords(reconcile(result.next))
    saveRecord(result.record, server.current)
  }

  function removeRecord(projectId: string, requirementId: string) {
    setRecords(reconcile(records.filter((record) => record.projectId !== projectId || record.requirementId !== requirementId)))
  }

  function lockRequirement(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({ ...record, lockedAt: record.lockedAt ?? now }))
  }

  function unlockRequirement(projectId: string, requirementId: string) {
    mutate(projectId, requirementId, (record) => ({
      ...record,
      lockedAt: undefined,
      designGeneratedAt: undefined,
      designLockedAt: undefined,
      developmentGeneratedAt: undefined,
      developmentLockedAt: undefined,
      testGeneratedAt: undefined,
      testLockedAt: undefined,
    }))
  }

  function markDesignGenerated(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({ ...record, designGeneratedAt: record.designGeneratedAt ?? now }))
  }

  function lockDesign(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({
      ...record,
      lockedAt: record.lockedAt ?? now,
      designGeneratedAt: record.designGeneratedAt ?? now,
      designLockedAt: record.designLockedAt ?? now,
    }))
  }

  function unlockDesign(projectId: string, requirementId: string) {
    mutate(projectId, requirementId, (record) => ({
      ...record,
      designLockedAt: undefined,
      developmentGeneratedAt: undefined,
      developmentLockedAt: undefined,
      testGeneratedAt: undefined,
      testLockedAt: undefined,
    }))
  }

  function markDevelopmentGenerated(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({
      ...record,
      developmentGeneratedAt: record.developmentGeneratedAt ?? now,
    }))
  }

  function lockDevelopment(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({
      ...record,
      lockedAt: record.lockedAt ?? now,
      designGeneratedAt: record.designGeneratedAt ?? now,
      designLockedAt: record.designLockedAt ?? now,
      developmentGeneratedAt: record.developmentGeneratedAt ?? now,
      developmentLockedAt: record.developmentLockedAt ?? now,
    }))
  }

  function unlockDevelopment(projectId: string, requirementId: string) {
    mutate(projectId, requirementId, (record) => ({
      ...record,
      developmentLockedAt: undefined,
      testGeneratedAt: undefined,
      testLockedAt: undefined,
    }))
  }

  function markTestGenerated(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({ ...record, testGeneratedAt: record.testGeneratedAt ?? now }))
  }

  function lockTest(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    mutate(projectId, requirementId, (record) => ({
      ...record,
      lockedAt: record.lockedAt ?? now,
      designGeneratedAt: record.designGeneratedAt ?? now,
      designLockedAt: record.designLockedAt ?? now,
      developmentGeneratedAt: record.developmentGeneratedAt ?? now,
      developmentLockedAt: record.developmentLockedAt ?? now,
      testGeneratedAt: record.testGeneratedAt ?? now,
      testLockedAt: record.testLockedAt ?? now,
    }))
  }

  return {
    records,
    getRecord,
    isLocked,
    isDesignLocked,
    isDevelopmentLocked,
    isTestLocked,
    lockRequirement,
    unlockRequirement,
    markDesignGenerated,
    lockDesign,
    unlockDesign,
    markDevelopmentGenerated,
    lockDevelopment,
    unlockDevelopment,
    markTestGenerated,
    lockTest,
    removeRecord,
  }
}
