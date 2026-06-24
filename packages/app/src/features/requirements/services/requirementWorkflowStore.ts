import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"

const STORAGE_KEY = "opencode.requirement.workflow.records"

export interface RequirementWorkflowRecord {
  projectId: string
  requirementId: string
  lockedAt?: string
  designGeneratedAt?: string
}

function normalize(raw: any): RequirementWorkflowRecord {
  return {
    projectId: raw.projectId ?? "",
    requirementId: raw.requirementId ?? "",
    lockedAt: raw.lockedAt,
    designGeneratedAt: raw.designGeneratedAt,
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

  function lockRequirement(projectId: string, requirementId: string) {
    const now = new Date().toISOString()
    const index = records.findIndex((record) => record.projectId === projectId && record.requirementId === requirementId)
    const next =
      index >= 0
        ? records.map((record, i) =>
            i === index ? { ...record, lockedAt: record.lockedAt ?? now, designGeneratedAt: record.designGeneratedAt ?? now } : record,
          )
        : [...records, { projectId, requirementId, lockedAt: now, designGeneratedAt: now }]
    setRecords(reconcile(next))
    saveRecords(next)
  }

  return {
    records,
    getRecord,
    isLocked,
    lockRequirement,
  }
}
