# Company TXT Provider

`company-txt` is an opt-in provider feature for company text-model endpoints that expose `/chatabc/init_session`, `/chatabc/chat`, and optional `/chatabc/upload_file` APIs. It is isolated to the provider layer and does not change opencode session execution, Local Server behavior, or other providers.

## Enable

Add a `company-txt` provider to the opencode config and select one of its models.

```json
{
  "provider": {
    "company-txt": {
      "name": "Company TXT",
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "qwen3-coder": {
          "name": "Qwen3 Coder",
          "tool_call": true,
          "limit": { "context": 262144, "output": 0 },
          "options": {
            "adapter": "qwen",
            "agent_urls": ["http://internal-qwen-agent"],
            "use_type": "agent",
            "tokenizer": "qwen3_6_35b_a3b",
            "image_token_budget": {
              "mode": "qwen_vl",
              "min_pixels": 65536,
              "max_pixels": 16777216,
              "patch_size": 16,
              "merge_size": 2
            }
          }
        }
      }
    }
  },
  "model": "company-txt/qwen3-coder"
}
```

To switch back, change `model` to another provider/model. To disable the feature without deleting config, add:

```json
{
  "disabled_providers": ["company-txt"]
}
```

## Model Options

- `agent_urls`: Required. String or array of company model endpoints. Multiple URLs are selected randomly per request.
- `adapter`: Optional. `qwen`, `kimi`, or `minimax`; controls prompt tool-call instructions and output parser.
- `parser`: Optional. Also participates in parser selection when `adapter` is not enough.
- `use_type`: Optional. `agent` or `workflow`; defaults to `agent`.
- `tokenizer`: Optional. Supported bundled values are `qwen3_6_35b_a3b`, `kimi_k2_5`, and `minimax_m2_5`. If omitted, opencode infers from model id / adapter / parser.
- `max_output_tokens`: Optional. Used for context budgeting when the request omits `max_tokens`.
- `context_window`: Optional. Overrides model `limit.context` for budgeting.
- `native_stop_sequences`: Optional. String or array appended as provider-side stop filters.
- `image_token_budget`: Optional. Supports `fixed` and `qwen_vl` modes.
- `maxUploadImages`: Optional. Defaults to `1`.
- `maxUploadImageBytes`: Optional. Defaults to `10485760`.

Provider-level options:

- `txtField` / `txt_field`: Optional. Company chat payload field for the rendered prompt; defaults to `txt`.
- `maxUploadImages`, `maxUploadImageBytes`: Optional defaults for all models.

## Supported Behavior

- OpenAI-compatible `/chat/completions` requests.
- OpenAI-compatible `/models` list response.
- Streaming and non-streaming responses.
- Progressive streaming of normal text until a native tool-call marker appears.
- Native tool-call parsing for Qwen, Kimi, and MiniMax formats.
- `parallel_tool_calls: false` limits returned tool calls to the first one.
- `tool_choice` and `response_format` are converted to control system messages.
- `metadata.prompt_variables`, `metadata.config_variables`, and `metadata.files` are passed to company APIs.
- Image inputs support `data:image/...;base64` and `http(s)` image URLs.
- Image uploads use `/chatabc/upload_file`.
- Token usage is calculated locally because the company API does not return accurate usage.

## Token Accounting

`company-txt` uses bundled tokenizer resources under:

```text
packages/opencode/src/provider/company-txt-tokenizers/
```

The tokenizer is loaded lazily on first use. Unknown or missing tokenizer names fall back to the coarse `chars / 4` estimate instead of failing the request.

Usage fields:

- `prompt_tokens`: rendered prompt tokens plus configured image token budget.
- `completion_tokens`: raw model output tokens.
- `total_tokens`: prompt plus completion.

This is intentionally scoped to `company-txt`; opencode's global compaction estimate is unchanged.

## Image Inputs

For `use_type: "agent"`, uploaded images are also added to the chat payload:

```json
{
  "file_id": "image_1",
  "url": "image_1.png",
  "content_type": "image"
}
```

For `use_type: "workflow"`, image filenames are appended to `config_variables` as `{ "name": "img", "value": "<filename>" }`.

## Limitations

- `live_delta` tool argument streaming is not implemented. Tool calls are emitted after the native tool-call block is complete.
- Token counting is implemented in TypeScript using bundled BPE/tiktoken vocabularies. It is much closer than character estimates, but it is not guaranteed to match Python `tokenizers` / `tiktoken` byte-for-byte for every Unicode edge case.
- Only image attachments are migrated. Audio, video, and PDFs are not supported by this provider adapter.
