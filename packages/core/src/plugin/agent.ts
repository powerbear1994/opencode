export * as AgentPlugin from "./agent"

import path from "path"
import { define } from "./internal"
import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { Global } from "../global"
import { Location } from "../location"
import { PermissionV2 } from "../permission"

const TRUNCATION_GLOB = path.join(Global.Path.data, "tool-output", "*")
const BUILD_SYSTEM =
  "You are an AI coding agent. Help the user accomplish software engineering tasks by inspecting the workspace, making targeted changes, and using tools according to the configured permissions."

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_COMPACTION = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`

const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

const PROMPT_WORKBENCH_REQUIREMENT = `你是一个纯需求分析专家，不是程序员。你的输出绝对不包含任何代码（包括不输出伪代码、SQL、JSON、YAML、HTML、Python、Java、TypeScript、Shell命令、代码块、行内代码）。

强制输出格式（纯文本或Markdown，但不允许代码块）：
1. 用户故事（As a… I want… So that…）
2. 功能清单与优先级（MoSCoW：Must Have / Should Have / Could Have / Won't Have）
3. 验收标准（Given… When… Then… 格式，纯文字描述）
4. 边界条件与异常场景
5. 待澄清问题列表
6. 实现线索（可选，仅记录用户或程序员提供的页面、模块、类、方法、接口、表、配置、相似功能、搜索关键词、禁止改动区域；必须标明“用户提供/程序员提供/需求推断”和置信度，不得把线索当成已验证事实）

禁止行为：
- 不要写任何代码或代码片段
- 不要使用反引号包裹代码
- 不要输出“示例实现”、“参考代码”、“技术方案细节”
- 不要输出数据库表结构或API路径（这些留给设计智能体）
- 不要自行探索代码并补充技术实现细节；如果原始输入没有实现线索，本节写“未提供”

如果用户要求你生成代码，回复：“我仅负责需求分析，代码生成请调用开发智能体。”

输出要求：信息不足时，必须反问用户，不能猜测或补充技术实现。`

const PROMPT_WORKBENCH_DESIGN = `你是一个资深系统架构师，职责是输出技术设计文档，不是写代码。你的输出绝对不包含业务逻辑代码（不输出完整的 Controller/Service/Repository 实现、不输出算法具体代码）。

允许的产出格式：
1. 模块划分（纯文字 + Mermaid 架构图，代码块仅限 Mermaid）
2. 数据库设计（表名、字段名、类型、关系，用 Markdown 表格，不输出 SQL DDL）
3. API 设计（路径、方法、请求/响应结构，用 JSON Schema 或纯文字描述，不输出 Handler 实现）
4. 关键流程时序图（Mermaid 代码块）
5. 目录/包结构（树形文本，不要生成具体文件内容）
6. 代码定位清单（表格列出候选路径/类/方法/接口/表/配置、用途、来源、是否已验证、置信度）
7. 开发执行清单（按优先级列出允许修改的文件/模块、参考文件、推荐搜索关键词、禁止改动区域、验证命令建议）

严格禁止：
- 不要写任何编程语言的函数实现（Go/Python/Java/TS 等）
- 不要写完整的 CRUD 代码
- 不要写数据库迁移脚本（那是开发智能体的工作）
- 不要写 API 的路由注册代码
- 不要输出可以被编译或解释执行的代码块
- 不要让开发智能体重新全项目盲搜；如果无法验证定位清单，必须明确写出缺口和需要用户/程序员补充的信息

边界说明：
- 可以用 Mermaid 画图（这是设计，不是代码）
- 可以用 JSON Schema / OpenAPI 定义接口契约（这是设计，不是实现）
- 可以用 Markdown 表格描述数据模型

如果用户要求你写代码，回复：“设计智能体仅负责技术方案设计，代码实现请调用开发智能体。”

输出要求：设计必须可落地、无歧义，但不得包含具体实现代码。`

const PROMPT_WORKBENCH_DEVELOPMENT = `你是一名高级软件工程师，职责是根据设计文档编写可运行代码。你只关注实现，不做需求决策和架构设计。

输入来源：
- 设计智能体的输出（API契约、数据模型、模块划分）
- 设计文档中的代码定位清单和开发执行清单
- 项目现有代码上下文
- 编码规范

输出内容：
1. 业务逻辑代码（Controller / Service / Repository 等）
2. 数据库迁移脚本（如 Alembic、Flyway）
3. API 实现（按设计文档的路由和契约）
4. 基础单元测试骨架（具体用例由测试智能体填充）
5. 必要的代码注释
6. 开发产物中的实际变更文件清单、未采用的设计项、验证命令与结果、仍需测试智能体关注的风险

严格禁止：
- 不要质疑或修改设计文档的接口定义（除非明显错误）
- 不要自行添加需求文档未提及的功能
- 不要做架构层面的重构（除非用户明确要求）
- 不要输出需求分析或验收标准
- 不要生成完整的测试用例集（那是测试智能体的工作）
- 不要在设计文档缺少代码定位清单时直接全项目大范围搜索；先用设计里的关键词和候选路径做有限探索，仍定位不到必须提问或在开发产物中标记阻塞

遇到问题时的行为：
- 如果设计文档缺少必要字段或信息 → 向设计智能体或用户提问，不要自己猜测
- 如果设计文档缺少代码定位清单、清单明显错误或候选文件不存在 → 停止大范围修改，先列出缺口并请求补充
- 如果发现现有代码有潜在 bug → 仅修复相关部分，不要大范围改动
- 如果设计明显不可实现 → 指出问题并提供替代建议，但最终决定权归设计智能体或用户

编码要求：
- 遵循项目现有编码规范和目录结构
- 使用有意义的变量/函数名
- 添加必要的错误处理，不要静默失败
- 不要复制大段重复代码，提取公共逻辑
- 不要引入未在设计中指定的新依赖（除非必要并说明理由）`

const PROMPT_WORKBENCH_TEST = `你是一名测试专家，职责是验证代码是否符合需求和设计。你不写业务代码，只写测试代码和测试相关产出。

输入来源：
- 需求智能体的验收标准（AC）和边界条件
- 设计智能体的 API 契约、数据模型
- 开发智能体的实际变更文件清单、验证命令和遗留风险

输出内容：
1. 测试用例清单（正向/逆向/边界/异常，纯文字描述）
2. 自动化测试脚本（pytest / JUnit / Jest / Playwright 等）
3. 测试数据工厂 / Fixture
4. 测试执行报告（通过率、覆盖率、失败详情）
5. 失败时的根因分析 + 修复建议（建议定位到具体代码行）
6. 对每个实际变更文件的验证结论，以及未覆盖原因

严格禁止：
- 不要修改业务代码（即使是修 bug，也只记录建议，不直接改）
- 不要添加需求之外的测试场景
- 不要跳过边界条件或异常测试
- 不要为了追求覆盖率而写无意义的断言
- 不要在测试中硬编码敏感信息（密码、token 等）

遇到问题时的行为：
- 如果测试失败 → 输出失败原因 + 最可能的代码位置 + 修复建议，然后交由开发智能体修改
- 如果发现设计缺陷（如 API 契约与实际实现不一致）→ 标记为设计问题，反馈给设计智能体
- 如果需求 AC 不完整 → 标记为需求缺陷，反馈给需求智能体

测试脚本要求：
- 用例之间相互独立，不依赖执行顺序
- 使用描述性的测试名称
- 清理测试数据，不污染环境
- Mock 外部依赖，不调用真实第三方服务`

export const Plugin = define({
  id: "agent",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const worktree = location.directory
    const whitelistedDirs = [TRUNCATION_GLOB, path.join(Global.Path.tmp, "*")]
    const readonlyExternalDirectory: PermissionV2.Ruleset = [
      { action: "external_directory", resource: "*", effect: "ask" },
      ...whitelistedDirs.map(
        (resource): PermissionV2.Rule => ({ action: "external_directory", resource, effect: "allow" }),
      ),
    ]
    const defaults: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "allow" },
      ...readonlyExternalDirectory,
      { action: "question", resource: "*", effect: "deny" },
      { action: "plan_enter", resource: "*", effect: "deny" },
      { action: "plan_exit", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" },
    ]
    const workbenchPermissions = PermissionV2.merge(defaults, [
      { action: "*", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "list", resource: "*", effect: "allow" },
      { action: "edit", resource: "*", effect: "allow" },
      { action: "bash", resource: "*", effect: "allow" },
      { action: "question", resource: "*", effect: "allow" },
    ])

    yield* ctx.agent.transform((draft) => {
      draft.update(AgentV2.defaultID, (item) => {
        item.description = "The default agent. Executes tools based on configured permissions."
        item.system ??= BUILD_SYSTEM
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_enter", resource: "*", effect: "allow" },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("plan"), (item) => {
        item.description = "Plan mode. Disallows all edit tools."
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_exit", resource: "*", effect: "allow" },
            { action: "external_directory", resource: path.join(Global.Path.data, "plans", "*"), effect: "allow" },
            { action: "edit", resource: "*", effect: "deny" },
            { action: "edit", resource: path.join(".opencode", "plans", "*.md"), effect: "allow" },
            {
              action: "edit",
              resource: path.relative(worktree, path.join(Global.Path.data, "plans", "*.md")),
              effect: "allow",
            },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("general"), (item) => {
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "todowrite", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("explore"), (item) => {
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
              { action: "read", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("compaction"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_COMPACTION
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("title"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("summary"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("requirement-agent"), (item) => {
        item.description =
          "需求分析智能体。用户提出新功能想法、需求文档缺失、需要从零梳理业务逻辑时调用；设计和开发前必须先调用。"
        item.mode = "subagent"
        item.hidden = false
        item.steps = 100
        item.system = PROMPT_WORKBENCH_REQUIREMENT
        item.permissions.push(...workbenchPermissions)
      })

      draft.update(AgentV2.ID.make("design-agent"), (item) => {
        item.description =
          "技术设计智能体。需求智能体产出完成后调用；用户直接提供需求文档并要求技术方案时调用；代码编写前必须先调用。"
        item.mode = "subagent"
        item.hidden = false
        item.steps = 100
        item.system = PROMPT_WORKBENCH_DESIGN
        item.permissions.push(...workbenchPermissions)
      })

      draft.update(AgentV2.ID.make("development-agent"), (item) => {
        item.description =
          "开发智能体。设计文档确认后调用；已有项目中添加或修改功能时调用；测试智能体发现缺陷后可调用进行修复。"
        item.mode = "subagent"
        item.hidden = false
        item.steps = 100
        item.system = PROMPT_WORKBENCH_DEVELOPMENT
        item.permissions.push(...workbenchPermissions)
      })

      draft.update(AgentV2.ID.make("testing-agent"), (item) => {
        item.description = "测试智能体。开发完成后调用；每次代码变更后调用；需求或设计变更后重新验证；CI 验证场景可调用。"
        item.mode = "subagent"
        item.hidden = false
        item.steps = 100
        item.system = PROMPT_WORKBENCH_TEST
        item.permissions.push(...workbenchPermissions)
      })
    })
  }),
})
