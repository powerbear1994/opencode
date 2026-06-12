import { createStore, type SetStoreFunction } from "solid-js/store"
import type { ExecutionStatus, RequirementExecutionRecord } from "../types"

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "opencode.requirement.execution.records"

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeRecord(raw: any): RequirementExecutionRecord {
  return {
    requirementId: raw.requirementId ?? "",
    projectId: raw.projectId ?? "",
    sessionId: raw.sessionId,
    sourceMode: raw.sourceMode ?? "prompt",
    content: raw.content ?? raw.prompt ?? "",
    status: raw.status ?? "not_started",
    sessionTitle: raw.sessionTitle,
    requirementTitle: raw.requirementTitle,
    projectName: raw.projectName,
    projectPath: raw.projectPath,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    implementationSummary: raw.implementationSummary,
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

  /**
   * Find a record by projectId + requirementId.
   * Scoping to project ensures records from different projects never collide.
   */
  function getRecord(projectId: string, requirementId: string): RequirementExecutionRecord | undefined {
    return records.find(
      (r) => r.requirementId === requirementId && r.projectId === projectId,
    )
  }

  function statusFor(projectId: string, requirementId: string): ExecutionStatus {
    return getRecord(projectId, requirementId)?.status ?? "not_started"
  }

  /**
   * Find the execution record linked to a session, scoped to a project.
   * Prevents cross-project record leakage.
   */
  function findBySessionId(projectId: string, sessionId: string): RequirementExecutionRecord | undefined {
    return records.find(
      (r) => r.sessionId === sessionId && r.projectId === projectId,
    )
  }

  function upsertRecord(record: RequirementExecutionRecord): void {
    const now = new Date().toISOString()
    // Match by BOTH projectId and requirementId — composite key
    const idx = records.findIndex(
      (r) => r.requirementId === record.requirementId && r.projectId === record.projectId,
    )

    if (idx >= 0) {
      setRecords(idx, "status", record.status)
      setRecords(idx, "content", record.content)
      setRecords(idx, "sourceMode", record.sourceMode)
      if (record.projectId !== undefined) setRecords(idx, "projectId", record.projectId)
      if (record.sessionId !== undefined) setRecords(idx, "sessionId", record.sessionId)
      if (record.sessionTitle !== undefined) setRecords(idx, "sessionTitle", record.sessionTitle)
      if (record.requirementTitle !== undefined) setRecords(idx, "requirementTitle", record.requirementTitle)
      if (record.projectName !== undefined) setRecords(idx, "projectName", record.projectName)
      if (record.projectPath !== undefined) setRecords(idx, "projectPath", record.projectPath)
      if (record.startedAt !== undefined) setRecords(idx, "startedAt", record.startedAt)
      if (record.completedAt !== undefined) setRecords(idx, "completedAt", record.completedAt)
      if (record.implementationSummary !== undefined) setRecords(idx, "implementationSummary", record.implementationSummary)
      setRecords(idx, "updatedAt", now)
    } else {
      setRecords(records.length, {
        ...record,
        createdAt: record.createdAt || now,
        updatedAt: now,
      })
    }

    saveRecords([...records])
  }

  /**
   * Update the execution status, scoped to project + requirement.
   * Handles lifecycle timestamps: startedAt when implementing, completedAt when done.
   */
  function updateStatus(projectId: string, requirementId: string, status: ExecutionStatus): void {
    const now = new Date().toISOString()
    const idx = records.findIndex(
      (r) => r.requirementId === requirementId && r.projectId === projectId,
    )
    if (idx < 0) return

    setRecords(idx, "status", status)
    setRecords(idx, "updatedAt", now)

    if (status === "implementing" && !records[idx].startedAt) {
      setRecords(idx, "startedAt", now)
    }
    if (status === "done") {
      setRecords(idx, "completedAt", now)
    }

    saveRecords([...records])
  }

  /**
   * Remove the session association, scoped to project + requirement.
   * Does NOT delete the real session or its messages.
   */
  function unlinkSession(projectId: string, requirementId: string): void {
    const now = new Date().toISOString()
    const idx = records.findIndex(
      (r) => r.requirementId === requirementId && r.projectId === projectId,
    )
    if (idx < 0) return

    setRecords(idx, "sessionId", "" as any)
    setRecords(idx, "sessionTitle", "" as any)
    setRecords(idx, "status", "not_started" as ExecutionStatus)
    setRecords(idx, "updatedAt", now)

    saveRecords([...records])
  }

  return {
    records,
    getRecord,
    statusFor,
    findBySessionId,
    upsertRecord,
    updateStatus,
    unlinkSession,
  }
}
