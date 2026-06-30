import { createSignal, Show } from "solid-js"
import { Splash } from "@opencode-ai/ui/logo"
import { useAuth } from "../context/auth"

export function LoginPage() {
  const auth = useAuth()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (loading()) return
    setLoading(true)
    setError("")
    try {
      await auth.login(username(), password())
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-[var(--v2-background-bg-base)]">
      <Splash class="w-16 h-20 mb-8 opacity-50" />
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 w-[320px]">
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-[530] text-[var(--v2-text-text-base)]" for="login-username">
            用户名
          </label>
          <input
            id="login-username"
            type="text"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
            placeholder="admin"
            disabled={loading()}
            class="h-9 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[13px] text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)] disabled:opacity-50"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-[530] text-[var(--v2-text-text-base)]" for="login-password">
            密码
          </label>
          <input
            id="login-password"
            type="password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            placeholder="输入密码"
            disabled={loading()}
            class="h-9 rounded-[6px] border border-[var(--v2-border-border-base)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[13px] text-[var(--v2-text-text-base)] outline-none transition-colors placeholder:text-[var(--v2-text-text-faint)] focus:border-[var(--v2-blue-400)] disabled:opacity-50"
          />
        </div>
        <Show when={error()}>
          <div class="rounded-[6px] border border-[var(--v2-red-400)]/40 bg-[var(--v2-red-400)]/10 px-3 py-2 text-[12px] text-[var(--v2-text-text-base)]">
            {error()}
          </div>
        </Show>
        <button
          type="submit"
          disabled={loading() || !username().trim() || !password().trim()}
          class="mt-2 inline-flex h-9 items-center justify-center rounded-[6px] bg-[var(--v2-text-text-base)] px-4 text-[13px] font-[530] text-[var(--v2-background-bg-base)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading() ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  )
}
