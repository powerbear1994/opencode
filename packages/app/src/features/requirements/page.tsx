import { createEffect, createSignal, Show, type Component } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { RequirementsProvider } from "./provider"
import { RequirementList } from "./list"
import { RequirementDetail } from "./detail"

// ── Inner Content (has access to RequirementsProvider context) ──────────

const RequirementsContent: Component = () => {
  const language = useLanguage()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams<{ selectedId?: string }>()

  // Support navigating from chat session card with ?selectedId=REQ-001
  createEffect(() => {
    const id = searchParams.selectedId
    if (id) {
      setSelectedId(id)
      setSearchParams({ selectedId: undefined })
    }
  })

  const handleSelect = (id: string) => {
    setSelectedId(id)
  }

  const handleBack = () => {
    setSelectedId(null)
  }

  return (
    <div class="flex flex-col h-full min-h-0 w-full">
      {/* Header */}
      <header class="shrink-0 flex items-center gap-3 px-5 pt-4 pb-2">
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">{language.t("requirements.title")}</h1>
      </header>

      {/* Body */}
      <div class="flex-1 min-h-0 flex">
        {/* List panel */}
        <div
          classList={{
            "h-full min-h-0": true,
            "border-r border-[var(--v2-border-border-base)]": !!selectedId(),
            "w-full max-w-[340px]": !selectedId(),
            "hidden xl:block xl:w-[340px] xl:shrink-0": !!selectedId(),
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
            />
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
