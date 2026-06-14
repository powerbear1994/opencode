import { Show, createSignal, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"

// ── Component ───────────────────────────────────────────────────────────────

export const PromptPanel: Component<{
  prompt: string | null
  onGenerate?: () => void
  onCopy?: () => void
  onRegenerate?: () => void
}> = (props) => {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)

  /** First ~100 chars as summary, trimmed at word break */
  function summary(text: string): string {
    if (text.length <= 100) return text
    return text.slice(0, 100).replace(/\n.*/s, "") + "…"
  }

  return (
    <div class="rounded-[8px] border border-[var(--v2-border-border-base)] overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-2.5 bg-[var(--v2-background-bg-layer-01)] border-b border-[var(--v2-border-border-base)]">
        <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)] shrink-0">
          {language.t("requirements.prompt.title")}
        </h3>

        <Show when={props.prompt}>
          <div class="flex items-center gap-1 ml-3 min-w-0">
            {/* Collapsed: show summary + expand */}
            <Show when={!expanded()}>
              <span class="text-[11px] text-[var(--v2-text-text-faint)] truncate mr-1">
                {summary(props.prompt!)}
              </span>
              <ButtonV2
                size="small"
                variant="ghost-muted"
                onClick={() => setExpanded(true)}
              >
                {language.t("requirements.prompt.expand")}
              </ButtonV2>
            </Show>

            {/* Expanded: show actions */}
            <Show when={expanded()}>
              <ButtonV2
                size="small"
                variant="ghost-muted"
                onClick={props.onCopy}
              >
                {language.t("requirements.prompt.copy")}
              </ButtonV2>
              <ButtonV2
                size="small"
                variant="ghost-muted"
                onClick={props.onRegenerate}
              >
                {language.t("requirements.prompt.regenerate")}
              </ButtonV2>
              <ButtonV2
                size="small"
                variant="ghost-muted"
                onClick={() => setExpanded(false)}
              >
                {language.t("requirements.prompt.collapse")}
              </ButtonV2>
            </Show>
          </div>
        </Show>
      </div>

      {/* Body */}
      <Show when={props.prompt}>
        <Show when={expanded()}>
          <div class="bg-[var(--v2-background-bg-layer-01)]">
            <div class="max-h-[240px] overflow-y-auto p-4">
              <pre class="text-[12px] leading-relaxed text-[var(--v2-text-text-muted)] whitespace-pre-wrap font-mono select-text">
                {props.prompt}
              </pre>
            </div>
          </div>
        </Show>
      </Show>

      {/* Empty state */}
      <Show when={!props.prompt}>
        <div class="bg-[var(--v2-background-bg-layer-01)] flex flex-col items-center justify-center py-5 gap-3">
          <p class="text-[12px] text-[var(--v2-text-text-faint)] leading-relaxed max-w-[280px] text-center">
            {language.t("requirements.prompt.emptyHint")}
          </p>
          <ButtonV2 size="small" icon="wand" onClick={props.onGenerate}>
            {language.t("requirements.prompt.generateAction")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}
