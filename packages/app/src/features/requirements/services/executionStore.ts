import { createStore, type SetStoreFunction } from "solid-js/store"
import type { ExecutionStatus, RequirementExecutionRecord } from "../types"

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "opencode.requirement.execution.records"

// ── Normalization ─────────────────────────────────────────────────────────────

/** Normalize an old-format record (with `prompt` field, without `projectId`/`sourceMode`) to the new shape */
function normalizeRecord(raw: any): RequirementExecutionRecord {
  return {
    requirementId: raw.requirementId ?? "",
    projectId: raw.projectId ?? "",
    sessionId: raw.sessionId,
    sourceMode: raw.sourceMode ?? "prompt", // old records default to "prompt" mode
    content: raw.content ?? raw.prompt ?? "", // old field "prompt" → "content"
    status: raw.status ?? "not_started",
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadRecords(): RequirementExecutionRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item: any) => normalizeRecord(item))
  } catch {
    return []
  }
}

function saveRecords(records: RequirementExecutionRecord[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // localStorage quota exceeded or disabled — silently ignore
  }
}

// ── Singleton Store ──────────────────────────────────────────────────────────

let store: RequirementExecutionRecord[] | undefined
let setStore: SetStoreFunction<RequirementExecutionRecord[]> | undefined

function ensureStore(): {
  records: RequirementExecutionRecord[]
  setRecords: SetStoreFunction<RequirementExecutionRecord[]>
} {
  if (!store || !setStore) {
    const [s, ss] = createStore<RequirementExecutionRecord[]>(loadRecords())
    store = s
    setStore = ss
  }
  return { records: store as RequirementExecutionRecord[], setRecords: setStore! }
}

// ── Public Hook ──────────────────────────────────────────────────────────────

export function useExecutionStore() {
  const { records, setRecords } = ensureStore()

  function getRecord(requirementId: string): RequirementExecutionRecord | undefined {
    return records.find((r) => r.requirementId === requirementId)
  }

  function statusFor(requirementId: string): ExecutionStatus {
    return getRecord(requirementId)?.status ?? "not_started"
  }

  function upsertRecord(record: RequirementExecutionRecord): void {
    const now = new Date().toISOString()
    const idx = records.findIndex((r) => r.requirementId === record.requirementId)

    if (idx >= 0) {
      // Update existing record in place
      setRecords(idx, "status", record.status)
      setRecords(idx, "content", record.content)
      setRecords(idx, "sourceMode", record.sourceMode)
      if (record.projectId !== undefined) {
        setRecords(idx, "projectId", record.projectId)
      }
      if (record.sessionId !== undefined) {
        setRecords(idx, "sessionId", record.sessionId)
      }
      setRecords(idx, "updatedAt", now)
    } else {
      // Add new record
      setRecords(records.length, {
        ...record,
        createdAt: record.createdAt || now,
        updatedAt: now,
      })
    }

    // Persist current state after mutation
    saveRecords([...records])
  }

  return {
    records,
    getRecord,
    statusFor,
    upsertRecord,
  }
}
