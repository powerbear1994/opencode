import { createEffect, createMemo, createSignal, Show, type Component } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/core/util/path"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { RequirementsProvider } from "./provider"
import { RequirementList } from "./list"
import { RequirementDetail } from "./detail"
import { resolveRequirementProject } from "./project-context"

// ── Inner Content (has access to RequirementsProvider context) ──────────

const RequirementsContent: Component = () => {
  const language = useLanguage()
  const server = useServer()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams<{ selectedId?: string; project?: string }>()
  const projectDir = createMemo(() =>
    resolveRequirementProject(
      searchParams.project,
      server.projects.list().map((project) => project.worktree),
    ),
  )

  // Support navigating from chat session card with ?selectedId=REQ-001
  createEffect(() => {
    const id = searchParams.selectedId
    setSelectedId(projectDir() ? (id ?? null) : null)
  })

  const handleSelect = (id: string) => {
    if (!projectDir()) return
    setSelectedId(id)
    setSearchParams({ project: projectDir(), selectedId: id })
  }

  const handleDefaultSelect = (id: string) => {
    if (!projectDir() || searchParams.selectedId) return
    setSelectedId(id)
  }

  return (
    <div class="flex flex-col h-full min-h-0 w-full">
      {/* Header */}
      <header class="shrink-0 flex items-center justify-between gap-4 border-b border-[var(--v2-border-border-base)] px-5 pt-4 pb-3">
        <h1 class="text-[16px] font-[530] text-[var(--v2-text-text-base)]">{language.t("requirements.title")}</h1>
        <Show when={projectDir()}>
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
      <div class="relative flex-1 min-h-0 flex">
        {/* List panel */}
        <div
          classList={{
            "h-full min-h-0": true,
            "border-r border-[var(--v2-border-border-base)]": !!selectedId(),
            "w-full max-w-[340px]": !selectedId(),
            "hidden lg:block lg:w-[300px] lg:shrink-0 xl:w-[340px]": !!selectedId(),
          }}
        >
          <RequirementList
            project={projectDir()}
            onSelect={handleSelect}
            onDefaultSelect={handleDefaultSelect}
            selectedId={selectedId()}
          />
        </div>

        {/* Detail panel */}
        <Show when={selectedId()}>
          <div class="flex-1 min-h-0 min-w-0" style="flex: 1 1 0%; min-width: 0">
            <RequirementDetail
              id={selectedId()!}
              project={projectDir()}
            />
          </div>
        </Show>
        <Show when={!selectedId()}>
          <div
            class="hidden items-center justify-center xl:flex"
            classList={{
              "absolute inset-0": !projectDir(),
              "flex-1": !!projectDir(),
            }}
          >
            <Show
              when={projectDir()}
              fallback={
                <div class="flex flex-col items-center gap-2 text-center">
                  <p class="text-[14px] font-[530] text-[var(--v2-text-text-muted)]">未选择项目</p>
                  <p class="text-[12px] text-[var(--v2-text-text-faint)]">
                    {language.t("requirements.list.noProject")}
                  </p>
                </div>
              }
            >
              <p class="text-[13px] text-[var(--v2-text-text-muted)]">
                {language.t("requirements.detail.selectHint")}
              </p>
            </Show>
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
