import path from "path"
import { fileURLToPath } from "url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "company-txt-tokenizers")
const CHARS_PER_TOKEN = 4
const TEXT_ENCODER = new TextEncoder()

type Tokenizer = {
  count(text: string): number
}

type TokenizerJson = {
  added_tokens?: Array<{ id: number; content: string; special?: boolean }>
  model?: {
    type?: string
    vocab?: Record<string, number>
    merges?: string[]
  }
}

const cache = new Map<string, Promise<Tokenizer | undefined>>()

export async function countCompanyTxtTokens(text: string, tokenizerName: unknown) {
  const name = typeof tokenizerName === "string" && tokenizerName.trim() ? tokenizerName.trim() : undefined
  if (!name) return estimateTokens(text)
  const tokenizer = await loadTokenizer(name)
  return tokenizer?.count(text) ?? estimateTokens(text)
}

export function estimateTokens(text: string) {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

function loadTokenizer(name: string) {
  const existing = cache.get(name)
  if (existing) return existing
  const pending = loadTokenizerInner(name).catch(() => undefined)
  cache.set(name, pending)
  return pending
}

async function loadTokenizerInner(name: string): Promise<Tokenizer | undefined> {
  const dir = path.join(ROOT, name)
  if (!(await Bun.file(path.join(dir, "config.json")).exists())) return
  const tokenizerJson = Bun.file(path.join(dir, "tokenizer.json"))
  if (await tokenizerJson.exists()) return jsonBPETokenizer(name, await tokenizerJson.json())
  const tiktoken = Bun.file(path.join(dir, "tiktoken.model"))
  if (await tiktoken.exists()) {
    const config = await Bun.file(path.join(dir, "tokenizer_config.json"))
      .json()
      .catch(() => ({}))
    return tikTokenTokenizer(await tiktoken.text(), specialTokens(config))
  }
}

function jsonBPETokenizer(name: string, input: TokenizerJson): Tokenizer | undefined {
  if (input.model?.type !== "BPE" || !input.model.vocab || !input.model.merges) return
  const bpe = makeBPE(input.model.vocab, input.model.merges)
  const added = new Map((input.added_tokens ?? []).map((item) => [item.content, item.id]))

  return {
    count(text) {
      return splitSpecial(text, added).reduce((total, segment) => {
        if (segment.special) return total + 1
        return (
          total +
          jsonPreTokenize(name, segment.text).reduce((sum, token) => sum + bpe(byteLevelEncode(token)).length, 0)
        )
      }, 0)
    },
  }
}

function tikTokenTokenizer(model: string, added: Map<string, number>): Tokenizer {
  const ranks = new Map<string, number>()
  for (const line of model.split(/\r?\n/)) {
    const [raw, rank] = line.trim().split(/\s+/)
    if (!raw || rank === undefined) continue
    ranks.set(Buffer.from(raw, "base64").toString("binary"), Number(rank))
  }
  const bpe = makeByteBPE(ranks)

  return {
    count(text) {
      return splitSpecial(text, added).reduce((total, segment) => {
        if (segment.special) return total + 1
        return (
          total + kimiPreTokenize(segment.text).reduce((sum, token) => sum + bpe(TEXT_ENCODER.encode(token)).length, 0)
        )
      }, 0)
    },
  }
}

function specialTokens(config: Record<string, unknown>) {
  const decoder = isRecord(config.added_tokens_decoder) ? config.added_tokens_decoder : {}
  return new Map(
    Object.entries(decoder).flatMap(([id, value]) => {
      if (!isRecord(value) || typeof value.content !== "string") return []
      return [[value.content, Number(id)]]
    }),
  )
}

function splitSpecial(text: string, special: Map<string, number>) {
  const tokens = [...special.keys()].sort((a, b) => b.length - a.length)
  if (!tokens.length) return [{ text, special: false }]
  const pattern = new RegExp(tokens.map(escapeRegExp).join("|"), "g")
  const result: Array<{ text: string; special: boolean }> = []
  let index = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > index) result.push({ text: text.slice(index, match.index), special: false })
    result.push({ text: match[0], special: true })
    index = match.index + match[0].length
  }
  if (index < text.length) result.push({ text: text.slice(index), special: false })
  return result
}

function jsonPreTokenize(name: string, text: string) {
  if (name.includes("minimax")) return minimaxPreTokenize(text)
  return qwenPreTokenize(text)
}

function qwenPreTokenize(text: string) {
  const normalized = text.normalize("NFC")
  const parts = normalized.match(
    /'(?:s|t|re|ve|m|ll|d)|[^\r\n\p{L}\p{N}]?[\p{L}\p{M}]+|\p{N}| ?[^\s\p{L}\p{M}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu,
  )
  return parts ?? []
}

function minimaxPreTokenize(text: string) {
  const normalized = text.normalize("NFC")
  const parts = normalized.match(
    /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?:'(?:s|t|re|ve|m|ll|d))?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?:'(?:s|t|re|ve|m|ll|d))?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu,
  )
  return parts ?? []
}

function kimiPreTokenize(text: string) {
  const parts = text.match(
    /[\p{Script=Han}]+|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?:'(?:s|t|re|ve|m|ll|d))?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?:'(?:s|t|re|ve|m|ll|d))?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu,
  )
  return parts ?? []
}

function makeBPE(vocab: Record<string, number>, merges: string[]) {
  const ranks = new Map(merges.map((merge, index) => [merge, index]))
  return (token: string) => {
    const parts = [...token]
    while (parts.length > 1) {
      const best = bestPair(parts, ranks)
      if (!best) break
      parts.splice(best.index, 2, parts[best.index]! + parts[best.index + 1]!)
    }
    return parts.map((part) => vocab[part] ?? -1)
  }
}

function makeByteBPE(ranks: Map<string, number>) {
  return (bytes: Uint8Array) => {
    const parts = [...bytes].map((byte) => String.fromCharCode(byte))
    while (parts.length > 1) {
      const best = bestPair(parts, ranks)
      if (!best) break
      parts.splice(best.index, 2, parts[best.index]! + parts[best.index + 1]!)
    }
    return parts
  }
}

function bestPair(parts: string[], ranks: Map<string, number>) {
  let best: { index: number; rank: number } | undefined
  for (let index = 0; index < parts.length - 1; index++) {
    const rank = ranks.get(parts[index]! + " " + parts[index + 1]!) ?? ranks.get(parts[index]! + parts[index + 1]!)
    if (rank === undefined) continue
    if (!best || rank < best.rank) best = { index, rank }
  }
  return best
}

function byteLevelEncode(text: string) {
  return [...TEXT_ENCODER.encode(text)].map((byte) => BYTE_ENCODER[byte]).join("")
}

const BYTE_ENCODER = byteEncoder()

function byteEncoder() {
  const bytes: number[] = []
  for (let value = 33; value <= 126; value++) bytes.push(value)
  for (let value = 161; value <= 172; value++) bytes.push(value)
  for (let value = 174; value <= 255; value++) bytes.push(value)
  const seen = new Set(bytes)
  const chars = [...bytes]
  let next = 0
  for (let value = 0; value < 256; value++) {
    if (seen.has(value)) continue
    bytes.push(value)
    chars.push(256 + next)
    next++
  }
  return Object.fromEntries(bytes.map((byte, index) => [byte, String.fromCharCode(chars[index]!)]))
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
