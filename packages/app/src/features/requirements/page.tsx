import { createEffect, createSignal, Show, type Component } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/core/util/path"
import { useLanguage } from "@/context/language"
import { RequirementsProvider } from "./provider"
import { RequirementList } from "./list"
import { RequirementDetail } from "./detail"

// ── Inner Content (has access to RequirementsProvider context) ──────────

const RequirementsContent: Component = () => {
  const language = useLanguage()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams<{ selectedId?: string; project?: string }>()

  // Support navigating from chat session card with ?selectedId=REQ-001
  createEffect(() => {
    const id = searchParams.selectedId
    setSelectedId(id ?? null)
  })

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setSearchParams({ selectedId: id })
  }

  const handleBack = () => {
    setSelectedId(null)
    setSearchParams({ selectedId: undefined })
  }

  return (
    <div class="flex flex-col h-full min-h-0 w-full">
      {/* Header */}
      <header class="shrink-0 flex items-center justify-between gap-4 px-5 pt-4 pb-3">
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">{language.t("requirements.title")}</h1>
        <Show when={searchParams.project}>
          {(project) => (
            <p
              class="min-w-0 truncate text-[12px] text-[var(--v2-text-text-muted)]"
              title={project()}
            >
              {language.t("requirements.detail.project")}：
              <span class="text-[var(--v2-text-text-base)]">{getFilename(project())}</span>
            </p>
          )}
        </Show>
      </header>

      {/* Body */}
      <div class="flex-1 min-h-0 flex">
        {/* List panel */}
        <div
          classList={{
            "h-full min-h-0": true,
            "border-r border-[var(--v2-border-border-base)]": !!selectedId(),
            "w-full max-w-[340px]": !selectedId(),
            "hidden lg:block lg:w-[300px] lg:shrink-0 xl:w-[340px]": !!selectedId(),
          }}
        >
          <RequirementList onSelect={handleSelect} selectedId={selectedId()} />
        </div>

        {/* Detail panel */}
        <Show when={selectedId()}>
          <div class="flex-1 min-h-0 min-w-0" style="flex: 1 1 0%; min-width: 0">
            <RequirementDetail
              id={selectedId()!}
              onBack={handleBack}
              project={searchParams.project}
            />
          </div>
        </Show>
        <Show when={!selectedId()}>
          <div class="hidden flex-1 items-center justify-center xl:flex">
            <p class="text-[13px] text-[var(--v2-text-text-muted)]">
              {language.t("requirements.detail.selectHint")}
            </p>
          </div>
        </Show>
      </div>
    </div>
  )
}

// ── Route Component ─────────────────────────────────────────────────────────

export default function RequirementsPage() {
  return (
    <RequirementsProvider>
      <RequirementsContent />
    </RequirementsProvider>
  )
}
