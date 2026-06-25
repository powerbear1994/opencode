import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import type { RequirementItem } from "./types"

// ── Status Badge ──────────────────────────────────────────────────────────

const STATUS_STYLE: Record<RequirementItem["status"], string> = {
  pending: "bg-[var(--v2-grey-400)]/15 text-[var(--v2-text-text-muted)]",
  confirming: "bg-[var(--v2-orange-400)]/15 text-[var(--v2-orange-700)]",
  done: "bg-[var(--v2-green-400)]/15 text-[var(--v2-green-600)]",
}

export const StatusBadge: Component<{ status: RequirementItem["status"] }> = (props) => {
  const language = useLanguage()
  return (
    <span
      class={`inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] ${STATUS_STYLE[props.status]}`}
    >
      {language.t(`requirements.status.${props.status}`)}
    </span>
  )
}

// ── Priority Badge ────────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<RequirementItem["priority"], string> = {
  high: "bg-[var(--v2-red-400)]/10 text-[var(--v2-red-700)]",
  medium: "bg-[var(--v2-yellow-400)]/10 text-[var(--v2-yellow-900)]",
  low: "bg-[var(--v2-grey-400)]/10 text-[var(--v2-text-text-faint)]",
}

export const PriorityBadge: Component<{ priority: RequirementItem["priority"] }> = (props) => {
  const language = useLanguage()
  return (
    <span
      class={`inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-[440] ${PRIORITY_STYLE[props.priority]}`}
    >
      {language.t(`requirements.priority.${props.priority}`)}
    </span>
  )
}
