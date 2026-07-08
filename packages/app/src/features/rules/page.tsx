import { Icon } from "@opencode-ai/ui/icon"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, ErrorBoundary, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import { authTokenFromCredentials } from "@/utils/server"
import { decode64 } from "@/utils/base64"
import { Identifier } from "@/utils/id"
import { Persist, persisted } from "@/utils/persist"
import { pathKey } from "@/utils/path-key"
import { isSessionNotFoundError } from "@/utils/server-errors"

type RuleInfo = {
  id: string
  title: string
  path: string
  source: "project" | "global" | "instruction"
  kind: "agents" | "claude" | "config"
  exists: boolean
  active: boolean
  editable: boolean
  remote: boolean
  blockedBy?: string
  content?: string
}

type RuleFile = {
  id: string
  title: string
  path: string
  content: string
  editable: boolean
}

type InitRecord = {
  sessionID: string
  directory: string
  startedAt: number
}

type ModelOption = {
  value: string
  label: string
  provider: string
}

const INIT_LOCK_TTL = 10 * 60 * 1000
const INIT_SESSION_CHECK_INTERVAL = 5000

function ErrorFallback(err: Error, reset: () => void) {
  return (
    <div class="flex flex-col items-center gap-3 py-8">
      <p class="text-[13px] text-[var(--v2-text-text-muted)]">规则加载失败：{err.message}</p>
      <button type="button" onClick={reset} class={secondaryButton()}>
        重试
      </button>
    </div>
  )
}

export default function RulesPage() {
  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <RulesContent />
    </ErrorBoundary>
  )
}

function RulesContent() {
  const server = useServer()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const navigate = useNavigate()
  const params = useParams<{ dir?: string }>()
  const [searchParams] = useSearchParams<{ project?: string }>()
  const [selected, setSelected] = createSignal<string>()
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<string>()
  const [actionError, setActionError] = createSignal<string>()
  const [initModelValue, setInitModelValue] = createSignal("")
  const [initStore, setInitStore] = persisted(
    Persist.serverGlobal(serverSDK().scope, "rules-init-session", ["rules-init-session.v1"]),
    createStore<{ sessions: Record<string, InitRecord | undefined> }>({ sessions: {} }),
  )

  const directory = createMemo(() => {
    if (params.dir) return decode64(params.dir) ?? ""
    return searchParams.project ?? ""
  })
  const directoryKey = createMemo(() => pathKey(directory()))
  const providers = useProviders(directory)

  const [rules, { refetch }] = createResource(
    () => ({ connection: server.current, directory: directory() }),
    (input) => requestRule<RuleInfo[]>(input.connection, { path: "/rule", directory: input.directory }),
  )

  const orderedRules = createMemo(() => rules() ?? [])
  const editableRules = createMemo(() => orderedRules().filter((rule) => rule.source !== "instruction"))
  const primaryRule = createMemo(() =>
    editableRules().find((rule) => rule.source === "project" && rule.exists && rule.active) ??
    editableRules().find((rule) => rule.source === "global" && rule.exists && rule.active) ??
    editableRules().find((rule) => rule.exists),
  )
  const selectedRule = createMemo(() => {
    const id = selected()
    return (id ? editableRules().find((rule) => rule.id === id) : undefined) ?? primaryRule()
  })

  createEffect(() => {
    const current = selected()
    if (current && editableRules().some((rule) => rule.id === current)) return
    setSelected(primaryRule()?.id)
  })

  const [file, { refetch: refetchFile }] = createResource(
    () => {
      const rule = selectedRule()
      if (!rule || !rule.exists || rule.remote) return
      return { connection: server.current, directory: directory(), id: rule.id }
    },
    (input) => requestRule<RuleFile>(input.connection, { path: "/rule/file", directory: input.directory, query: { id: input.id } }),
  )

  createEffect(() => {
    const value = file()
    if (!value) return
    setDraft(value.content)
    setMessage(undefined)
    setActionError(undefined)
  })

  const projectAgents = createMemo(() => orderedRules().find((rule) => rule.id === "project-agents"))
  const globalAgents = createMemo(() => orderedRules().find((rule) => rule.id === "global-agents"))
  const canCreateGlobal = createMemo(() => !globalAgents())
  const canRunInit = createMemo(() => !!directory() && !projectAgents())
  const initRecord = createMemo(() => initStore.sessions[directoryKey()])
  const initActive = createMemo(() => {
    const record = initRecord()
    if (!record || projectAgents()) return false
    return Date.now() - record.startedAt < INIT_LOCK_TTL
  })
  const canCreateProject = createMemo(() => !!directory() && !projectAgents() && !initActive())
  const editable = createMemo(() => !!file()?.editable)
  const dirty = createMemo(() => draft() !== (file()?.content ?? ""))
  const projectRules = createMemo(() => orderedRules().filter((rule) => rule.source === "project"))
  const globalRules = createMemo(() => orderedRules().filter((rule) => rule.source === "global"))
  const instructionRules = createMemo(() => orderedRules().filter((rule) => rule.source === "instruction"))
  const initModelOptions = createMemo<ModelOption[]>(() =>
    providers
      .connected()
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          value: `${provider.id}/${model.id}`,
          label: model.name,
          provider: provider.name,
        })),
      )
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)),
  )
  const selectedInitModelOption = createMemo(() => initModelOptions().find((option) => option.value === initModelValue()))
  const initModel = createMemo(() => {
    const selected = modelSelection(initModelValue())
    if (selected) return selected
    const defaults = providers.default()
    for (const provider of providers.connected()) {
      const configured = defaults[provider.id]
      if (configured && provider.models[configured]) return { providerID: provider.id, modelID: configured }
      const model = Object.values(provider.models)[0]
      if (model) return { providerID: provider.id, modelID: model.id }
    }
  })

  const clearInitRecord = (record: InitRecord) => {
    if (initStore.sessions[directoryKey()]?.sessionID !== record.sessionID) return
    setInitStore("sessions", directoryKey(), undefined)
  }

  const checkInitSession = async (record: InitRecord) => {
    try {
      await serverSDK().ensureDirSdkContext(record.directory).client.session.get({ sessionID: record.sessionID })
    } catch (err) {
      if (isSessionNotFoundError(err, record.sessionID)) clearInitRecord(record)
    }
  }

  createEffect(() => {
    if (!projectAgents() || !initRecord()) return
    setInitStore("sessions", directoryKey(), undefined)
  })

  createEffect(() => {
    const record = initRecord()
    if (!record || projectAgents()) return
    if (Date.now() - record.startedAt < INIT_LOCK_TTL) return
    setInitStore("sessions", directoryKey(), undefined)
  })

  createEffect(() => {
    const record = initRecord()
    if (!record || projectAgents()) return
    void checkInitSession(record)
    const timer = setInterval(() => void checkInitSession(record), INIT_SESSION_CHECK_INTERVAL)
    onCleanup(() => clearInterval(timer))
  })

  const save = async () => {
    const rule = selectedRule()
    if (!rule || !editable()) return
    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      const updated = await requestRule<RuleInfo>(server.current, {
        path: "/rule",
        method: "PATCH",
        directory: directory(),
        payload: { id: rule.id, content: draft() },
      })
      setSelected(updated.id)
      await refetch()
      await refetchFile()
      setMessage("已保存。新的会话会使用这份规则。")
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const createRule = async (source: "project" | "global") => {
    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      const created = await requestRule<RuleInfo>(server.current, {
        path: "/rule",
        method: "POST",
        directory: directory(),
        payload: { source, content: "" },
      })
      await refetch()
      setSelected(created.id)
      setDraft("")
      await refetchFile()
      setMessage(`已创建 ${created.title}。`)
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const startInit = () => {
    if (!directory()) {
      setActionError("请先打开一个项目。")
      return
    }
    dialog.push(() => <InitDialog />)
  }

  const runInit = async () => {
    if (!directory()) {
      setActionError("请先打开一个项目。")
      return
    }
    const model = initModel()
    if (!model) {
      setActionError("当前没有可用模型，无法智能生成项目规则。")
      return
    }

    setBusy(true)
    setActionError(undefined)
    setMessage(undefined)
    try {
      const sdk = serverSDK().ensureDirSdkContext(directory())
      const session = await sdk.client.session.create().then((response) => response.data)
      if (!session) throw new Error("无法创建规则生成会话。")
      dialog.close()
      const record = {
        sessionID: session.id,
        directory: directory(),
        startedAt: Date.now(),
      }
      setInitStore("sessions", directoryKey(), record)
      void sdk.client.session.init({
        sessionID: session.id,
        providerID: model.providerID,
        modelID: model.modelID,
        messageID: Identifier.ascending("message"),
      }).catch((err) => {
        clearInitRecord(record)
        console.error("[rules] failed to start /init", err)
      })
      setMessage("已开始分析项目，正在生成项目规则。")
      navigate(`/${base64Encode(directory())}/session/${session.id}`)
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex h-full min-h-0 w-full min-w-0 self-stretch flex-col bg-[var(--v2-background-bg-base)]">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--v2-border-border-base)] px-5 py-3">
        <div class="min-w-0">
          <h1 class="text-[16px] font-[530] leading-7 text-[var(--v2-text-text-base)]">规则</h1>
          <p class="text-[12px] text-[var(--v2-text-text-muted)]">查看当前生效的规则来源，编辑项目或全局规则文件。</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={canRunInit()}>
            <button type="button" onClick={startInit} disabled={busy() || initActive()} class={primaryButton()}>
              {initActive() ? "正在智能生成" : "智能生成项目规则"}
            </button>
          </Show>
          <Show when={canCreateProject()}>
            <button type="button" onClick={() => void createRule("project")} disabled={busy()} class={secondaryButton()}>
              新建项目规则
            </button>
          </Show>
          <Show when={canCreateGlobal()}>
            <button type="button" onClick={() => void createRule("global")} disabled={busy()} class={secondaryButton()}>
              新建全局规则
            </button>
          </Show>
        </div>
      </div>

      <div class="min-h-0 w-full flex-1 overflow-hidden px-5 py-4">
        <div class="flex h-full min-h-0 w-full flex-col gap-3">
          <Switch>
            <Match when={rules.loading && orderedRules().length === 0}>
              <div class="h-full min-h-[420px] animate-pulse rounded-[8px] bg-[var(--v2-background-bg-layer-01)]" />
            </Match>
            <Match when={rules.error}>
              <div class="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-[8px] border border-[var(--v2-border-border-base)] py-10">
                <p class="text-[13px] text-[var(--v2-text-text-muted)]">暂时无法读取规则。</p>
                <button type="button" onClick={() => void refetch()} class={secondaryButton()}>
                  重试
                </button>
              </div>
            </Match>
            <Match when>
              <div class="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
                <section class="flex min-h-0 flex-col rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-00)]">
                  <div class="border-b border-[var(--v2-border-border-base)] px-4 py-3">
                    <h2 class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">规则来源</h2>
                    <p class="mt-1 text-[11px] leading-4 text-[var(--v2-text-text-muted)]">
                      只展示当前已加载的规则和附加说明。
                    </p>
                  </div>
                  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    <Show when={projectRules().length > 0}>
                      <RuleStackGroup title="项目规则">
                        <For each={projectRules()}>
                          {(rule) => <RuleStackItem rule={rule} active={selectedRule()?.id === rule.id} onClick={() => setSelected(rule.id)} />}
                        </For>
                      </RuleStackGroup>
                    </Show>
                    <Show when={globalRules().length > 0}>
                      <RuleStackGroup title="全局规则">
                        <For each={globalRules()}>
                          {(rule) => <RuleStackItem rule={rule} active={selectedRule()?.id === rule.id} onClick={() => setSelected(rule.id)} />}
                        </For>
                      </RuleStackGroup>
                    </Show>
                    <Show when={instructionRules().length > 0}>
                      <RuleStackGroup title="附加说明">
                        <For each={instructionRules()}>{(rule) => <InstructionItem rule={rule} />}</For>
                      </RuleStackGroup>
                    </Show>
                  </div>
                </section>

                <section class="flex min-h-0 flex-1 flex-col rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-00)]">
                  <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--v2-border-border-base)] px-4 py-3">
                    <div class="min-w-0">
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 class="truncate text-[14px] font-[530] text-[var(--v2-text-text-base)]">
                          {selectedRule()?.title ?? "还没有规则文件"}
                        </h2>
                        <RuleStatusBadge rule={selectedRule()} />
                      </div>
                      <p class="mt-1 truncate text-[12px] text-[var(--v2-text-text-muted)]">{selectedRule()?.path ?? "新建或智能生成后即可开始编写项目规则。"}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <Show when={message()}>
                        {(value) => <span class="text-[12px] text-[var(--v2-text-text-muted)]">{value()}</span>}
                      </Show>
                      <button type="button" onClick={save} disabled={!editable() || !dirty() || busy()} class={primaryButton()}>
                        保存
                      </button>
                    </div>
                  </div>

                  <Show
                    when={selectedRule()?.exists}
                    fallback={
                      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                        <Icon name="sliders" size="large" class="text-[var(--v2-text-text-faint)]" />
                        <p class="text-[13px] text-[var(--v2-text-text-muted)]">还没有可编辑的规则文件。</p>
                        <Show when={initActive()}>
                          <p class="max-w-[460px] text-[12px] text-[var(--v2-text-text-muted)]">
                            正在生成项目规则。完成后回到这里即可查看和编辑。
                          </p>
                        </Show>
                        <Show when={canRunInit()}>
                          <button type="button" onClick={startInit} disabled={busy() || initActive()} class={primaryButton()}>
                            {initActive() ? "正在智能生成" : "智能生成项目规则"}
                          </button>
                        </Show>
                      </div>
                    }
                  >
                    <Show
                      when={!selectedRule()?.remote}
                      fallback={<div class="flex min-h-0 flex-1 items-center justify-center px-4 py-8 text-[13px] text-[var(--v2-text-text-muted)]">远程附加说明会参与加载，但不能在这里编辑。</div>}
                    >
                      <textarea
                        value={draft()}
                        onInput={(event) => setDraft(event.currentTarget.value)}
                        readOnly={!editable() || busy()}
                        placeholder={rulePlaceholder(selectedRule())}
                        spellcheck={false}
                        class="min-h-0 flex-1 resize-none border-0 bg-transparent px-4 py-3 font-mono text-[12px] leading-5 text-[var(--v2-text-text-base)] outline-none placeholder:text-[var(--v2-text-text-faint)]"
                      />
                    </Show>
                  </Show>
                  <Show when={actionError()}>
                    {(value) => <div class="border-t border-[var(--v2-border-border-base)] px-4 py-2 text-[12px] text-[var(--v2-red-400)]">{value()}</div>}
                  </Show>
                </section>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )

  function InitDialog() {
    return (
      <Dialog title="智能生成项目规则" size="large">
        <div class="flex flex-col gap-5 px-2 pb-2 pt-1">
          <div class="rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-4 py-3">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-500)]">
                <Icon name="sliders" size="small" class="size-4" />
              </span>
              <div class="min-w-0">
                <p class="text-[13px] font-[530] text-[var(--v2-text-text-base)]">选择生成模型</p>
                <p class="mt-0.5 text-[12px] leading-relaxed text-[var(--v2-text-text-muted)]">
                  将创建新会话并运行 /init 分析当前项目，完成后生成 AGENTS.md。
                </p>
              </div>
            </div>
          </div>

          <label class="flex flex-col gap-2 rounded-[8px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-00)] px-3 py-2.5">
            <span class="flex flex-col gap-0.5">
              <span class="text-[12px] font-[530] text-[var(--v2-text-text-base)]">生成模型</span>
              <span class="text-[11px] leading-4 text-[var(--v2-text-text-muted)]">
                选择用于运行 /init 的模型；不选择时使用当前默认模型。
              </span>
            </span>
            <SelectV2
              appearance="large"
              placeholder="使用默认模型"
              options={initModelOptions()}
              current={selectedInitModelOption()}
              value={(option) => option.value}
              label={(option) => `${option.provider} / ${option.label}`}
              groupBy={(option) => option.provider}
              onSelect={(option) => setInitModelValue(option?.value ?? "")}
              disabled={busy() || initActive()}
              style={{ width: "100%" }}
            />
          </label>

          <Show when={actionError()}>
            {(value) => (
              <div class="rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 py-2 text-[12px] text-[var(--v2-text-text-base)]">
                {value()}
              </div>
            )}
          </Show>

          <div class="flex items-center justify-end gap-2.5 border-t border-[var(--v2-border-border-base)] pt-5">
            <button type="button" onClick={() => dialog.close()} disabled={busy()} class={secondaryButton()}>
              取消
            </button>
            <button type="button" onClick={() => void runInit()} disabled={busy() || initActive() || !initModel()} class={primaryButton()}>
              {busy() ? "正在开始" : "开始生成"}
            </button>
          </div>
        </div>
      </Dialog>
    )
  }
}

function RuleStackGroup(props: { title: string; children: JSX.Element }) {
  return (
    <div class="min-w-0 px-3 py-2">
      <h3 class="mb-1.5 text-[11px] font-[530] uppercase tracking-0 text-[var(--v2-text-text-muted)]">{props.title}</h3>
      <div class="flex flex-col gap-1">{props.children}</div>
    </div>
  )
}

function RuleStackItem(props: { rule: RuleInfo; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex min-w-0 items-center gap-2 rounded-[6px] border px-2.5 py-2 text-left transition-colors"
      classList={{
        "border-transparent hover:border-[var(--v2-border-border-base)] hover:bg-[var(--v2-background-bg-layer-01)]":
          !props.active,
        "border-[var(--v2-blue-400)]/30 bg-[var(--v2-blue-400)]/5": props.active,
      }}
    >
      <StatusDot rule={props.rule} />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]">{props.rule.title}</span>
          <span class="shrink-0 text-[11px] text-[var(--v2-text-text-muted)]">{ruleStatusText(props.rule)}</span>
        </div>
        <p class="mt-0.5 truncate text-[11px] text-[var(--v2-text-text-muted)]">{props.rule.path}</p>
      </div>
    </button>
  )
}

function InstructionItem(props: { rule: RuleInfo }) {
  return (
    <div class="flex min-w-0 items-center gap-3 px-4 py-2.5">
      <StatusDot rule={props.rule} />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-[12px] font-[530] text-[var(--v2-text-text-base)]">{props.rule.title}</span>
          <span class="shrink-0 rounded-[999px] bg-[var(--v2-background-bg-layer-02)] px-2 py-0.5 text-[11px] text-[var(--v2-text-text-muted)]">
            {props.rule.remote ? "远程来源" : "本地文件"}
          </span>
        </div>
        <p class="mt-0.5 truncate text-[11px] text-[var(--v2-text-text-muted)]">{props.rule.path}</p>
      </div>
    </div>
  )
}

function RuleStatusBadge(props: { rule?: RuleInfo }) {
  const rule = () => props.rule
  return (
    <Show when={rule()}>
      {(value) => (
        <span
          class="rounded-[999px] px-2 py-0.5 text-[11px]"
          classList={{
            "bg-[var(--v2-blue-400)]/10 text-[var(--v2-blue-400)]": value().exists && value().active && !value().remote,
            "bg-[var(--v2-background-bg-layer-02)] text-[var(--v2-text-text-muted)]":
              value().exists && (!value().active || value().remote),
            "border border-[var(--v2-border-border-base)] text-[var(--v2-text-text-muted)]": !value().exists,
          }}
        >
          {ruleStatusText(value())}
        </span>
      )}
    </Show>
  )
}

function ruleStatusText(rule: RuleInfo) {
  if (!rule.exists) return "未创建"
  if (rule.remote) return "远程来源"
  if (rule.blockedBy) return "已被同层规则覆盖"
  if (rule.active) return "已加载"
  if (!rule.editable) return "只读"
  return "未生效"
}

function rulePlaceholder(rule?: RuleInfo) {
  if (!rule) return ""
  if (rule.source === "project") return "在这里写下这个项目需要遵循的规则"
  if (rule.source === "global") return "在这里写下所有项目默认遵循的规则"
  return ""
}

function StatusDot(props: { rule: RuleInfo }) {
  return (
    <span
      class="h-2.5 w-2.5 shrink-0 rounded-full"
      classList={{
        "bg-[var(--v2-green-500)]": props.rule.exists && props.rule.active,
        "bg-[var(--v2-text-text-faint)]": props.rule.exists && !props.rule.active,
        "border border-[var(--v2-border-border-base)]": !props.rule.exists,
      }}
    />
  )
}

function secondaryButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] font-[530] text-[var(--v2-text-text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-50"
}

function primaryButton() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--v2-text-text-base)] px-3 text-[12px] font-[530] text-[var(--v2-background-bg-base)] transition-opacity hover:opacity-90 disabled:opacity-50"
}

function modelSelection(value: string) {
  const [providerID, ...modelParts] = value.split("/")
  const modelID = modelParts.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

function requestRule<T>(
  connection: ServerConnection.Any | undefined,
  input: {
    path: string
    method?: "GET" | "POST" | "PATCH"
    directory?: string
    query?: Record<string, string>
    payload?: unknown
  },
) {
  if (!connection) throw new Error("当前服务器不可用。")
  const url = new URL(input.path, connection.http.url)
  if (input.directory) url.searchParams.set("directory", input.directory)
  Object.entries(input.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))

  const headers: Record<string, string> = {}
  if (input.payload !== undefined) headers["Content-Type"] = "application/json"
  if (connection.http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: connection.http.username,
      password: connection.http.password,
    })}`
  }

  return fetch(url, {
    method: input.method ?? "GET",
    headers,
    body: input.payload === undefined ? undefined : JSON.stringify(input.payload),
  }).then(async (response) => {
    const text = await response.text()
    const data = text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text
    if (!response.ok) throw new Error(errorMessage(data))
    return data as T
  })
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  if (typeof err === "string" && err.trim()) return err
  if (typeof err === "object" && err !== null) {
    const data = "data" in err ? err.data : undefined
    if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string") return data.message
    if ("message" in err && typeof err.message === "string") return err.message
    if ("error" in err && typeof err.error === "string") return err.error
  }
  return "操作失败。"
}
