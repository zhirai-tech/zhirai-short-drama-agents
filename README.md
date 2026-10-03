# ZHIRAI Short-Drama Agent Crew — DeepSeek Harness 插件

把 **ZHIRAI AI 短剧系统**里真实存在的整套 Agent 架构（6 个运行时 Agent + 调度关系 + 生产阶段口径）
复制成一个**可安装到 DeepSeek Harness 的独立插件**（bundle）。

- **COPY，不是 MOVE**：源 AI 短剧项目一行代码都没改。插件是独立副本，装到任何 Harness 上都不需要源项目存在。
- **模型由 Harness 选择**：插件**不声明任何产商/模型**。
- **完整架构说明**：见 [AGENT-ARCHITECTURE.md](./AGENT-ARCHITECTURE.md)。

---

## 一、包含什么

| Agent（preset id） | 源 Role | 说明 |
|---|---|---|
| `zhirai-director` | DIRECTOR | 主创作助手：总调度，唯一可派活；挂 `ask-user` + 5 个具名派活工具 |
| `zhirai-writer` | WRITER | 编剧：剧本 / 对白 / 分镜 |
| `zhirai-artist` | ARTIST | 画师：定妆照 / 场景图 / 参考图 |
| `zhirai-voice-actor` | VOICE_ACTOR | 配音师：台词配音 / 旁白 |
| `zhirai-music-composer` | MUSIC_COMPOSER | 音乐师：背景音乐 |
| `zhirai-editor` | EDITOR | 剪辑师：视频成片 |

每个 Agent 的 `persona.prefix` 是源系统**运行版本 prompt 的原文**（仅把 `{language}` 占位符展开为语言指令）。
逐字一致性由 `scripts/validate-bundle.mjs` 强制校验（与源 `dev.db` 的 `Agent.prompt_template` 逐字比对）。

## 二、目录结构

```
zhirai-short-drama-agents/
├── package.json                 ← bundle manifest（dsh.bundle.patch 指向下方 patch）
├── icon.svg                     ← 插件卡片图标
├── index.js                     ← Host 插件（apply/Config；暴露只读架构服务）
├── cordis.patch.yml             ← 【生成物】1 个 Host 行 + 6 个 agent-preset 声明
├── locale/{zh,en}.json          ← 插件卡片标题/描述
├── agents/
│   ├── definitions.js           ← Agent 身份/关系/上下文/工具映射（唯一数据源）
│   ├── prompts.json             ← 【生成物】6 个 Agent 的源码 prompt 全文（可审计）
│   └── zhirai-*/SKILL.md        ← 【生成物】各角色的职责与生产阶段口径
├── _extracted-agents.json       ← 源系统 dev.db 导出（复制依据，可复核）
└── scripts/
    ├── build-bundle.mjs         ← 生成 cordis.patch.yml / SKILL.md / locale / prompts.json
    ├── validate-bundle.mjs      ← 静态校验（YAML 用 DSH 自带 js-yaml；schema 对照 DSH 真实 Config）
    ├── compare-with-shipped.mjs ← 与 DSH 自带 preset 做结构同构对照
    └── verify-standalone.mjs    ← 无源项目环境下独立加载验证
```

## 三、安装

官方安装入口是 **`plugin_manager`**（`action: install_bundle`，`target` = 本目录的绝对路径）。
它会自行完成包安装与 bundle 选择，**不要**手动改 profile 的 `package.json` / `cordis.patch.yml`，也不要手动跑 pnpm。

```
plugin_manager(action: "install_bundle", target: "<本目录绝对路径>")
```

装完读返回值的 `application` 与 `warnings` 字段判断是否生效（`applied` 才算生效）。
随后用 `cordis_inspect_query` 确认新增的 `preset-zhirai-*` 行。

**Web UI 路径**：侧边栏 → 插件（Plugins）→ 安装 bundle → 选择本目录。

### 启用 / 禁用

- 启用后：6 个 Agent 出现在 Harness 的 Agent 预设名册（`dsh-client-ui-agent-preset`），用户可直接选择。
- 禁用后：Harness 原有开发能力不受影响（本插件是独立 bundle，未改动任何 Harness 核心包）。

## 五、已完成的真实验证（Harness 内真实运行）

本插件已在真实的 DeepSeek Harness 运行时中加载并完成真实创作任务，链路为：

```
用户请求 → Harness（dsh CLI / headless surface）
         → 插件 Agent（zhirai-director，源系统 Director prompt）
         → Harness 模型系统（@deepseek-ai/dsh-llm + dsh-agent-default-model）
         → 模型实际执行（deepseek-official / deepseek-flash）
         → Agent 返回结果
```

实测输出（任务：《最后一班地铁》立项）严格遵循源 prompt 的工作流：

```
## 项目定位   ← 源 prompt 规定的逐字小节名
## 故事总纲   ← 源 prompt 规定的逐字小节名
…确认后我再展开第一季完整故事与分集卡。
[AWAIT_CONFIRM]   ← 源 prompt 规定的确认标记
```

复现方式（Desktop 安装没有把 `dsh` 放进 PATH，用 Electron 的 Node 模式调官方 CLI 入口）：

```powershell
$exe = '...\DeepSeek Harness.exe'
$bin = '...\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:ELECTRON_RUN_AS_NODE = '1'
# 1) 把插件装进 profile（等价官方 plugin_manager install_bundle 的包安装步骤）
pnpm --dir "$env:DSH_PROFILE_DIR" add "link:<本目录绝对路径>"
# 2) 用官方 --patch 叠加层加载插件（不改任何现有 profile）
'<任务文本>' | & $exe -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]).href).then(m=>m.runCli())" $bin --profile <profile> --patch "<本目录>\cordis.patch.yml"
```

注意：任务必须经 **stdin** 传入（位置参数在 Electron Node 模式下会被启动链吃掉）。

### 关于 persona 的入口（重要）

| surface | persona 入口 | 为什么 |
|---|---|---|
| Web 等挂载了 preset 系统的 surface | `cordis.patch.yml` 内的 6 个 `agent-preset` 声明 + `agent-preset-registry.default = zhirai-director` | 官方 preset 机制 |

插件**不再**做顶层的 `id: system-prompt` 覆盖：那会把整个 Harness（含默认会话）的 persona 换成 Director prompt，污染所有非 ZHIRAI 会话。现在 6 个 Agent 的身份**只**由各自的 preset 提供 —— 会话选中某个 preset 时，preset 作用域内的 `@deepseek-ai/dsh-persona` 会遮蔽部署 persona，可见性范围正好限制在 ZHIRAI 会话内。

## 六、模型如何选择（任务书 §八/§九）

插件内**零**模型声明：

- 没有 `provider:`（除 subagent 的 `provider: spawn`，那是**子 Agent 后端名**，不是模型供应商）
- 没有 `model:`
- `agents/definitions.js` 的 `MODEL_BINDING.policy = 'HOST-MANAGED'`，`declaredProviders/declaredModels` 均为空数组

实际模型来自 Harness：
`@deepseek-ai/dsh-agent-default-model`（profile 默认）+ 用户当前 Session 的模型选择
（`dsh-client-ui-model-selection`）。换模型不需要改插件。

## 五、Tool / Skill 复用

| 能力 | 复用 DSH 包 | 状态 |
|---|---|---|
| 结构化提问（源 `ask_user_choice`） | `@deepseek-ai/dsh-tool-ask-user` | 复用 |
| 派活（源 `dispatch_agent`） | `@deepseek-ai/dsh-tool-subagent` ×5 | 复用 |
| 子 Agent 后端 | `@deepseek-ai/dsh-subagent`（provider `spawn`） | 复用 |
| 角色职责技能 | `@deepseek-ai/dsh-skill-filesystem` | 复用 |
| 项目文件读取（源 `read_project_content`） | `@deepseek-ai/dsh-tool-fs`（由 Harness base 提供） | 复用 |
| 记忆检索（源 `recall_project_memory`） | — | **GAP：DSH 无对应 seam，插件不伪造** |
| 图片/视频生成（源 `generate_image` / `generate_video`） | — | 由 Harness 按能力选择，插件不绑定 |

## 六、自行校验（不需要安装）

```powershell
# 1) 生成产物（改 definitions.js 后必须重跑）
node scripts/build-bundle.mjs

# 2) 静态校验：YAML + DSH 真实 schema + 与源 prompt 逐字一致
node scripts/validate-bundle.mjs "<js-yaml 所在 node_modules>"

# 3) 与 DSH 自带 preset 结构同构对照 + 依赖包存在性
node scripts/compare-with-shipped.mjs "<js-yaml node_modules>" "<app.asar 路径>"

# 4) 无源项目环境下独立加载验证
node scripts/verify-standalone.mjs
```

## 七、边界（刻意不做）

- 不复制源系统的数据库 / 生产链 / 前端 / API / 视频与图片系统 —— 只复制 Agent 层。
- 不实现支付 / 会员 / License / 订阅 / 账号系统。
- 不新增第二套 Model Router：模型一律由 Harness 决定。
- 不修改 Harness 核心包。
