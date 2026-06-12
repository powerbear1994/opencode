import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"

// ── Component ───────────────────────────────────────────────────────────────

export const PromptPanel: Component<{
  prompt: string
}> = (props) => {
  const language = useLanguage()

  return (
    <div class="flex flex-col gap-3">
      <h3 class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">
        {language.t("requirements.prompt.title")}
      </h3>

      <pre class="text-[12px] leading-relaxed text-[var(--v2-text-text-muted)] bg-[var(--v2-background-bg-deep)] border border-[var(--v2-border-border-base)] rounded-[8px] p-4 max-h-80 overflow-y-auto whitespace-pre-wrap font-mono select-text">
        {props.prompt}
      </pre>
    </div>
  )
}
