import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"

const STORAGE_KEY = "opencode.requirement.workflow.records"

export interface RequirementWorkflowRecord {
  projectId: string
  requirementId: string
  lockedAt?: string
  designGeneratedAt?: string
  designLockedAt?: string
  developmentGeneratedAt?: string
  developmentLockedAt?: string
  testGeneratedAt?: string
  testLockedAt?: string
}

function normalize(raw: unknown): RequirementWorkflowRecord {
  const record = typeof raw === "object" && raw !== null ? raw as Partial<RequirementWorkflowRecord> : {}
  return {
    projectId: record.projectId ?? "",
    requirementId: record.requirementId ?? "",
    lockedAt: record.lockedAt,
    designGeneratedAt: record.designGeneratedAt,
    designLockedAt: record.designLockedAt,
    developmentGeneratedAt: record.developmentGeneratedAt,
    developmentLockedAt: record.developmentLockedAt,
    testGeneratedAt: record.testGeneratedAt,
    testLockedAt: record.testLockedAt,
  }
}

function loadRecords(): RequirementWorkflowRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalize)
  } catch {
    return []
  }
}

function saveRecords(records: RequirementWorkflowRecord[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {}
}

let store: RequirementWorkflowRecord[] | undefined
let setStore: SetStoreFunction<RequirementWorkflowRecord[]> | undefined

function ensureStore() {
  if (!store || !setStore) {
    const [s, ss] = createStore<RequirementWorkflowRecord[]>(loadRecords())
    store = s
    setStore = ss
  }
  return { records: store as RequirementWorkflowRecord[], setRecords: setStore }
}

export function useRequirementWorkflow() {
  const { records, setRecords } = ensureStore()

  function getRecord(projectId: string, requirementId: string) {
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

  function lockRequirement(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index ? { ...record, lockedAt: record.lockedAt ?? now } : record,
          )
        : [...records, { projectId, requirementId, lockedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function unlockRequirement(projectId: string, requirementId: string) {
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    if (index < 0) return
    const next = records.map((record, i) =>
      i === index
        ? {
            ...record,
            lockedAt: undefined,
            designGeneratedAt: undefined,
            designLockedAt: undefined,
            developmentGeneratedAt: undefined,
            developmentLockedAt: undefined,
            testGeneratedAt: undefined,
            testLockedAt: undefined,
          }
        : record,
    )
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function markDesignGenerated(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index ? { ...record, designGeneratedAt: record.designGeneratedAt ?? now } : record,
          )
        : [...records, { projectId, requirementId, designGeneratedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function lockDesign(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index
              ? { ...record, designGeneratedAt: record.designGeneratedAt ?? now, designLockedAt: record.designLockedAt ?? now }
              : record,
          )
        : [...records, { projectId, requirementId, designGeneratedAt: now, designLockedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function unlockDesign(projectId: string, requirementId: string) {
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    if (index < 0) return
    const next = records.map((record, i) =>
      i === index
        ? {
            ...record,
            designLockedAt: undefined,
            developmentGeneratedAt: undefined,
            developmentLockedAt: undefined,
            testGeneratedAt: undefined,
            testLockedAt: undefined,
          }
        : record,
    )
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function markDevelopmentGenerated(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index ? { ...record, developmentGeneratedAt: record.developmentGeneratedAt ?? now } : record,
          )
        : [...records, { projectId, requirementId, developmentGeneratedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function lockDevelopment(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index
              ? {
                  ...record,
                  developmentGeneratedAt: record.developmentGeneratedAt ?? now,
                  developmentLockedAt: record.developmentLockedAt ?? now,
                }
              : record,
          )
        : [...records, { projectId, requirementId, developmentGeneratedAt: now, developmentLockedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function unlockDevelopment(projectId: string, requirementId: string) {
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    if (index < 0) return
    const next = records.map((record, i) =>
      i === index
        ? {
            ...record,
            developmentLockedAt: undefined,
            testGeneratedAt: undefined,
            testLockedAt: undefined,
          }
        : record,
    )
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function markTestGenerated(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index ? { ...record, testGeneratedAt: record.testGeneratedAt ?? now } : record,
          )
        : [...records, { projectId, requirementId, testGeneratedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  function lockTest(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index
              ? {
                  ...record,
                  testGeneratedAt: record.testGeneratedAt ?? now,
                  testLockedAt: record.testLockedAt ?? now,
                }
              : record,
          )
        : [...records, { projectId, requirementId, testGeneratedAt: now, testLockedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
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
  }
}
