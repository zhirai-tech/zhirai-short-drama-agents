# AI Short Drama Agent Architecture

本文档描述 **ZHIRAI AI 短剧系统**（源系统）中**真实存在**的 Agent 架构，以及它被复制成 DeepSeek Harness 插件后的对应关系。

> 事实来源（全部为实际代码/数据，不是设计意图）：
> | 来源 | 内容 |
> |---|---|
> | `apps/api/src/modules/agent/default-agents.ts` | 6 个系统 Agent 的身份（role/name/genre/description）与 prompt 常量 |
> | `dev.db` → `Agent` 表（`is_system=1`） | **运行中**的 prompt 与 tools（本插件采用这一份） |
> | `apps/api/src/modules/agent/agent-capability.ts` | `TOOL_CALLING_ROLES`、`AGENT_ROLE_TO_CORE_KEYS`、`AGENT_TOOL_CATALOG` |
> | `apps/api/src/modules/textmatrix/text-matrix.registry.ts` | 9 个生产阶段的职责、输入输出协议、上下游 |
> | `apps/api/src/modules/creative/production-stage.ts` | `MAIN_STAGE_ORDER` 主链路阶段顺序与标签 |
> | `apps/api/src/modules/chat/chat.service.ts` | `buildDirectorTools()` / `dispatchAgent()` —— 真实调度实现 |

---

## 一、两层 Agent 架构

源系统里「Agent」有两层，**都不是推测**：

### 第一层：运行时 Agent 舰队（6 个）—— 可被调用/派活

| # | Role | Name | 职责（源 description 原文） | 工具调用 | Prompt 长度 |
|---|---|---|---|---|---|
| 1 | `DIRECTOR` | 主创作助手 | 总调度，可调用所有智能体 | ✅ 唯一具备 | 10,746 字 |
| 2 | `WRITER` | 编剧 | 剧本创作 & 场景对白 & 分镜规划 | ❌ | 253 字 |
| 3 | `ARTIST` | 画师 | 角色定妆照 & 场景背景图生成（按需产出完整角色视觉资产：三视图/半身图/细节图） | ❌ | 908 字 |
| 4 | `VOICE_ACTOR` | 配音师 | 角色语音合成 & 旁白朗读 | ❌ | 187 字 |
| 5 | `MUSIC_COMPOSER` | 音乐师 | 背景音乐生成 & 混音 | ❌ | 178 字 |
| 6 | `EDITOR` | 剪辑师 | 视频合成 & 超分增强 & 输出 | ❌ | 157 字 |

**事实**：`agent-capability.ts` 的 `TOOL_CALLING_ROLES = ['DIRECTOR']` —— 只有 Director 有工具调用循环；其余 5 个角色的 `Agent.tools = []`（DB 实测），它们**只被 Director 派活**，不能自行调用工具。

### 第二层：文本生产阶段（9 个 stage）—— 不是独立 Agent 实例

`TEXT_MATRIX_STAGE_ORDER` 定义 9 个**专业能力**（`STAGE_AGENTS`），每个有独立职责 / 独立输入 / 独立输出 JSON 结构：

| Stage | 承载角色 | 输入（源 `inputLabel` 原文） |
|---|---|---|
| `MAIN` | DIRECTOR | 用户 Topic + 项目上下文 |
| `DIRECTOR` | DIRECTOR | 上游 MAIN plan + 用户 Topic + 检索到的领域/风格 Intelligence + 用户/项目经验 |
| `STORY` | WRITER | 上游 MAIN plan + 用户 Topic + 项目/记忆上下文 |
| `SCRIPT` | WRITER | 上游 STORY 结果 |
| `CHARACTER` | ARTIST | 上游 SCRIPT（含 STORY 设定的角色） |
| `SCENE` | ARTIST | 上游 SCRIPT + CHARACTER |
| `STORYBOARD` | WRITER | 上游 SCRIPT + CHARACTER + SCENE |
| `IMAGE_PROMPT` | ARTIST | 上游 CHARACTER + SCENE + STORYBOARD/SHOT |
| `VIDEO_PROMPT` | EDITOR | 上游 SHOT + IMAGE_PROMPT + CHARACTER/SCENE |

**注意**：`AGENT_ROLE_TO_CORE_KEYS` 把角色映射到 stage 作为「记忆/经验范围」，因此 stage 是**角色的职责范围**，不是第 7~N 个 Agent 实例。插件据此把每个角色的 stage 职责写入该角色的 **SKILL.md**，不再新增 preset。

---

## 二、调度关系（谁调用谁）

```
                        ┌──────────────────────────────┐
                        │   用户 / 对话入口            │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  DIRECTOR  主创作助手          │
                        │  · 唯一具备工具调用循环        │
                        │  · 唯一可派活                  │
                        │  · 承载 MAIN / DIRECTOR 阶段   │
                        └───┬───┬───┬───┬───┬──────────┘
      dispatch_agent(role)  │   │   │   │   │
        ┌───────────────────┘   │   │   │   └───────────────────┐
        │           ┌───────────┘   │   └───────────┐           │
        ▼           ▼               ▼               ▼           ▼
   ┌────────┐  ┌────────┐    ┌───────────┐  ┌──────────────┐  ┌────────┐
   │ WRITER │  │ ARTIST │    │VOICE_ACTOR│  │MUSIC_COMPOSER│  │ EDITOR │
   │ 编剧   │  │ 画师   │    │ 配音师    │  │ 音乐师       │  │ 剪辑师 │
   ├────────┤  ├────────┤    ├───────────┤  ├──────────────┤  ├────────┤
   │ STORY  │  │CHARACTER│   │ VOICE     │  │ MUSIC        │  │VIDEO_  │
   │ SCRIPT │  │ SCENE  │    └───────────┘  └──────────────┘  │PROMPT  │
   │STORY-  │  │STORY-  │                                     │ VIDEO  │
   │BOARD   │  │BOARD   │                                     └────────┘
   └────────┘  │IMAGE_  │
               │PROMPT  │
               └────────┘
```

### 调用关系事实

| 关系 | 事实来源 | 说明 |
|---|---|---|
| 谁能派活 | `TOOL_CALLING_ROLES = ['DIRECTOR']` | 只有 Director |
| 派活的 5 个目标 | `dispatch_agent` 的 `role` enum | `WRITER / ARTIST / VOICE_ACTOR / MUSIC_COMPOSER / EDITOR` |
| 谁可直接被用户调用 | 对话入口 + `AGENTS` 列表 | 6 个都作为 Agent 记录存在；实际对话入口是 Director |
| 谁只能被 Agent 调用 | `Agent.tools = []` 的 5 个角色 | 它们没有工具，无法自行调用外部能力 |

### 数据传递（stage 流水线）

主链路阶段顺序（`MAIN_STAGE_ORDER`）：
`OUTLINE → STORY → SCRIPT → CHARACTER → SCENE → VOICE → STORYBOARD → IMAGE → VIDEO`

其中文字类 stage 的输出以**严格 JSON** 传给下游（`STAGE_AGENTS[*].outputSchema`），例如：
- `STORY` → `{title, premise, logline, conflict, world, characters[], beats[]}`
- `SCRIPT` → `{episodes[{episode, summary, scenes[{sceneIndex, location, time, summary, action, dialogue[], narrative}]}]}`
- `CHARACTER` → `{characters[{name, role, gender, age, personality, appearance, backstory, relationships, consistency}]}`
- `STORYBOARD` → `{shots[{episode, shotNo, sceneId, characters[], action, camera{shotType, movement}, visual, dialogue, durationSec}]}`
- `IMAGE_PROMPT` → `{prompts[{shotNo, characters[], scene, englishPrompt, negative, aspectRatio}]}`
- `VIDEO_PROMPT` → `{prompts[{shotNo, englishPrompt, movement, timing, continuity, referenceNotes}]}`

**事实源**：`text-matrix.registry.ts` 的 `STAGE_AGENTS[*].outputSchema`（原文，未改写）。

---

## 三、上下文（Agent 正常工作所需）

| 上下文 | 源系统来源 | Harness 对应机制 |
|---|---|---|
| conversation context | 会话消息历史 | Session 消息历史（Harness 原生） |
| project context | Project + description + Workspace 文件 | Workspace 文件 |
| story context | `02_完整故事.md`（文件即事实源） | Workspace 文件读取 |
| character context | 角色 canonical（DB）+ 定妆资产 | Workspace 文件 + Skill |
| scene context | 场景设计 | Workspace 文件 + Skill |
| production context | `ProductionState` / `ProductionTask`（DB） | Skill 记录口径 + Workspace 文件（**不搬 DB**） |
| memory / references | ProjectMemory / UserMemory | **能力缺口**（见下） |

---

## 四、Tool / Skill

### Director 的 6 个工具（源 `Agent.tools` 原文）

| 源工具 | DSH 映射 | 状态 |
|---|---|---|
| `ask_user_choice` | `@deepseek-ai/dsh-tool-ask-user` | **MAPPED** |
| `dispatch_agent` | `@deepseek-ai/dsh-tool-subagent` ×5 具名实例 | **MAPPED** |
| `read_project_content` | `@deepseek-ai/dsh-tool-fs` / workspaceFiles | **MAPPED** |
| `recall_project_memory` | 无对应 provider seam | **GAP**（不伪造） |
| `generate_image` | 由 Harness 模型/工具系统按能力选择 | **HOST-PROVIDED** |
| `generate_video` | 同上 | **HOST-PROVIDED** |

### Skill

源系统**没有** Skill 概念，它用 `AGENT_ROLE_TO_CORE_KEYS` 把角色映射到 stage 作为记忆范围。
插件把这一层落成**每个角色一个 SKILL.md**（含源 `STAGE_AGENTS.duty` 原文 + 上下游），由 `dsh-skill-filesystem` 提供、`dsh-tool-skill` 触发加载。

---

## 五、插件化映射

| 源系统 | 插件（DeepSeek Harness） |
|---|---|
| 6 个「Agent」记录 | 6 个 `@deepseek-ai/dsh-agent-preset` 声明（用户可在 Harness 里选） |
| `Agent.prompt_template` | `@deepseek-ai/dsh-persona` 的 `prefix`（**原文**，仅展开 `{language}`） |
| `Agent.tools` | preset 的 `plugins` 行（`ask-user` + 5 个具名 `tool-subagent`） |
| `TOOL_CALLING_ROLES` | 只有 Director 的 preset 挂派活工具（执行角色不挂） |
| `dispatch_agent(role, task)` | 5 个具名 subagent provider（`w_dispatch` / `a_dispatch` / `v_dispatch` / `m_dispatch` / `e_dispatch`） |
| `AGENT_ROLE_TO_CORE_KEYS` | 各角色 `agents/<preset>/SKILL.md` |
| ModelManager → Provider | **Harness 模型系统**（插件不声明任何模型，见 `agents/definitions.js` 的 `MODEL_BINDING`） |
| 数据库 / 生产链 / 前端 | **不复制**（本阶段只复制 Agent 层） |
