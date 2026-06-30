import { describe, expect, test } from "bun:test"
import { countCompanyTxtTokens, estimateTokens } from "../../src/provider/company-txt-tokenizer"

describe("company-txt tokenizer", () => {
  test("loads bundled qwen byte-level BPE tokenizer", async () => {
    const text = "hello world, 你好"

    expect(await countCompanyTxtTokens(text, "qwen3_6_35b_a3b")).toBeGreaterThan(0)
    expect(await countCompanyTxtTokens(text, "qwen3_6_35b_a3b")).not.toBe(estimateTokens(text))
  })

  test("loads bundled kimi tiktoken vocabulary", async () => {
    const text = "hello world, 你好"

    expect(await countCompanyTxtTokens(text, "kimi_k2_5")).toBeGreaterThan(0)
    expect(await countCompanyTxtTokens("<|im_end|>", "kimi_k2_5")).toBe(1)
  })

  test("loads bundled minimax byte-level BPE tokenizer", async () => {
    const text = "hello world, 你好"

    expect(await countCompanyTxtTokens(text, "minimax_m2_5")).toBeGreaterThan(0)
    expect(await countCompanyTxtTokens(text, "minimax_m2_5")).not.toBe(estimateTokens(text))
  })

  test("falls back to estimate for unknown tokenizer", async () => {
    const text = "fallback text"

    expect(await countCompanyTxtTokens(text, "missing")).toBe(estimateTokens(text))
  })
})
