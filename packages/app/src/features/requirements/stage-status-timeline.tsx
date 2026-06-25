import { For, type Component } from "solid-js"

export type StageStatusItem = {
  label: string
  value: string
  active?: boolean
  complete?: boolean
}

export const StageStatusTimeline: Component<{ items: StageStatusItem[] }> = (props) => (
  <div class="flex flex-col text-[12px]">
    <For each={props.items}>
      {(item, index) => {
        const active = () => !!item.active
        const complete = () => !!item.complete
        const last = () => index() === props.items.length - 1
        return (
          <div class="relative flex min-h-9 items-start justify-between gap-3">
            <div
              class="absolute left-[5px] top-[13px] h-[calc(100%-9px)] w-px"
              classList={{
                "hidden": last(),
                "bg-[var(--v2-green-500)]/70": complete(),
                "bg-[var(--v2-blue-400)]/50": active() && !complete(),
                "bg-[var(--v2-border-border-base)]": !complete() && !active(),
              }}
            />
            <div class="flex min-w-0 items-start gap-2.5">
              <div
                class="relative z-[1] mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border bg-[var(--v2-background-bg-layer-01)]"
                classList={{
                  "border-[var(--v2-green-500)] shadow-[0_0_0_3px_var(--v2-green-500)/12]": complete(),
                  "border-[var(--v2-blue-400)] shadow-[0_0_0_3px_var(--v2-blue-400)/12]": active() && !complete(),
                  "border-[var(--v2-border-border-base)]": !complete() && !active(),
                }}
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  classList={{
                    "bg-[var(--v2-green-500)]": complete(),
                    "bg-[var(--v2-blue-400)]": active() && !complete(),
                    "bg-[var(--v2-text-text-faint)]/40": !complete() && !active(),
                  }}
                />
              </div>
              <p
                class="min-w-0 font-[530] leading-[16px]"
                classList={{
                  "text-[var(--v2-text-text-base)]": active() || complete(),
                  "text-[var(--v2-text-text-muted)]": !active() && !complete(),
                }}
              >
                {item.label}
              </p>
            </div>
            <span
              class="shrink-0 rounded-[4px] px-1.5 py-0.5 text-right text-[11px] leading-none"
              classList={{
                "bg-[var(--v2-green-500)]/10 text-[var(--v2-green-600)]": complete(),
                "bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-400)]": active() && !complete(),
                "text-[var(--v2-text-text-faint)]": !complete() && !active(),
              }}
            >
              {item.value}
            </span>
          </div>
        )
      }}
    </For>
  </div>
)
