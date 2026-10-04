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
| `zhirai-director` | DIRECTOR | **ZHIRAI 创作总导演**（源系统称「主创作助手」）：总调度，唯一可派活；挂 `ask-user` + 5 个具名派活工具。是**普通子 Agent**，不占用 Harness 官方 Main Agent 的主位。⚠️ 其中 4 条派活工具当前**暂时停用**，见下节 |
| `zhirai-writer` | WRITER | 编剧：剧本 / 对白 / 分镜 |
| `zhirai-artist` | ARTIST | 画师：定妆照 / 场景图 / 参考图 |
| `zhirai-voice-actor` | VOICE_ACTOR | 配音师：台词配音 / 旁白 |
| `zhirai-music-composer` | MUSIC_COMPOSER | 音乐师：背景音乐 |
| `zhirai-editor` | EDITOR | 剪辑师：视频成片 |

### ✅ 能力发现：运行时读取 Harness 授予的能力（不再维护工具白名单）

**架构**：ZHIRAI 不再把「有哪些工具」当作自己要维护的知识。

```
Harness Runtime（注册表：tools / skills / agentPresets / sandboxPolicy …）
        ↓  ZHIRAI 只读，不复制
Capability Discovery Adapter（agents/capability-discovery.js，极薄一层）
        ↓
ZHIRAI 创作总导演：收到任务 → 先问 Runtime → 按任务选能力 → 原生方式调用 → 需要时回读验证
```

- 适配器**不重新实现任何工具 / registry**：它调用 Harness 官方
  `ctx.tools.schemas(scope)`、`ctx.skills.list({scope})`、`ctx.agentPresets.list()`、
  `ctx.sandboxPolicy.resolve()`，把结果如实交给总导演。
- 唯一新增的工具是只读的 `capabilities` 发现入口（相当于官方 `cordis_inspect` 的只读投影），
  **不是业务工具**。它的输出完全来自 Runtime，没有任何硬编码清单。
- **权限的 Source of Truth 仍然是 Harness**：适配器只读沙箱策略，不做任何 allow/deny 判断；
  被 Harness 拒绝的调用照实报告，不能绕过。

**两个实测得来的硬约束**（写在适配器与构建脚本注释里，避免后人踩坑）：

1. `ctx.tools.schemas()` **不传 scope 只返回宿主 global 层** —— 在 preset 作用域里实测得到
   **0 个工具**；必须传「查看者 Agent 对象」（`exec.agent`），同一 agent 实测得到 19 个。
2. 发现只能**读取**授权、不能**创造**授权：一个零工具行的 preset，调发现只会拿到空目录。
   所以 preset 里那几条 mount 行是 **Harness 挂载机制的要求**（`dsh-web-app` 把 agent-plane 行
   统一 `disabled`，要求各 preset 自己重新挂载），**不是 ZHIRAI 的能力白名单**。
   「某能力此刻是否真可用」一律以发现的实时结果为准。

**实测结果**（详见下文「能力发现实测」一节）：新增能力进入 Runtime 后，
ZHIRAI **零代码改动**即可发现并使用。

### ✅ 真实落盘能力（Harness 原生文件工具，非自造）

**问题**：总导演能连续产出大量正文，却始终「已准备、等待写盘」——Windows 上既没有项目目录也没有文件。

**根因**：agent preset 的 `plugins:` 决定该 Agent 能看到哪些工具。部署里
`tool-fs` / `tool-fs-search` / `skill-filesystem` / `tool-skill` 这些 **agent-plane 行被
`dsh-web-app` 的 base 层设为 `disabled: true`**，只由各 preset 自己重新挂载。
原来的 `zhirai-director` preset **一条都没挂**，所以它没有任何写盘工具。

**修法**：在原 preset 内补挂 **Harness 官方行**（不新增自定义工具、不复制文件系统实现）：

| 行 | 官方包 | 提供 |
|---|---|---|
| `tool-fs` | `@deepseek-ai/dsh-tool-fs` | `read` / `write` / `edit` 等真实文件读写 |
| `tool-fs-search` | `@deepseek-ai/dsh-tool-fs-search` | `glob` / `grep`（`sampleOverCapGlobResults` 为必填） |
| `skill-filesystem` | `@deepseek-ai/dsh-skill-filesystem` | 只扫本插件自带技能目录（`includeDefaultRoots: false`） |
| `tool-skill` | `@deepseek-ai/dsh-tool-skill` | `skill` 工具：按需加载角色技能 |

刻意**不挂** `@deepseek-ai/dsh-fs-local`：宿主已经挂了 `dsh-fs-sandbox`，重复挂载会二次注册
`ctx.fs` 并导致加载失败。宿主侧的 `dsh-fs-sandbox` / `fs-observation-policy` 已存在，
所以只要 preset 挂上 `tool-fs`，`write` 就会真实落盘、并**自动创建父目录**。

另外，`persona` 是 `complete: true`，会**丢掉 suffix**，而部署把 cwd 放在 suffix 里 ——
因此 DIRECTOR 的 prefix 现在以 `Your working directory is {{cwd}}.` 开头，
保证模型知道真实工作目录而不是去猜路径。

### 固定项目结构与 Single Source of Truth（系统固定行为）

已写入 DIRECTOR 的 persona（不需要用户每次在提示词里描述）：

```
<项目名>/
├─ 01_项目/      项目定位、故事总纲、分季规划
├─ 02_人物/      角色设定与角色视觉资产的文字口径
├─ 03_剧本/      分集剧本、对白、旁白
├─ 04_分集/      每集卡片与节奏表
├─ 05_分镜/      分镜与镜头表
├─ 06_提示词/    图片/视频提示词（本阶段只产出文字）
├─ 07_制作资源/  制作资源清单（本阶段只登记，不生产）
└─ 08_执行/      执行状态与进度
```

- **结构化数据只有一个 canonical source**：分镜/分集卡等以 **JSON 为唯一事实源**，
  Markdown 是**导出视图**，不允许维护两份会各自漂移的数据；
- 禁止为「看起来有文件」而复制重复内容；
- 落盘必须走闭环：`write` → `read` **回读验证** → 报告**真实绝对路径**与文件大小；
- 读写任一步失败必须**如实说明**（权限 / 沙箱 / 路径 / 工具缺失），
  禁止出现「已准备 N 份材料」「等待写盘」「已归档」这类没有对应真实文件的话术。

### ⚠️ 临时状态：总导演的四条派活边已暂停（非删除）

当前处于**文字创作联调阶段**，只跑通这一条链：

```
用户 → Harness 官方 Main Agent → ZHIRAI 创作总导演 → w_dispatch → 编剧 → 项目文件
```

| 派活工具 | 目标 Agent | 当前状态 |
|---|---|---|
| `w_dispatch` | WRITER 编剧 | ✅ **启用**（唯一放行） |
| `a_dispatch` | ARTIST 画师 | ⏸ 暂停（`disabled: true`） |
| `v_dispatch` | VOICE_ACTOR 配音师 | ⏸ 暂停（`disabled: true`） |
| `m_dispatch` | MUSIC_COMPOSER 音乐师 | ⏸ 暂停（`disabled: true`） |
| `e_dispatch` | EDITOR 剪辑师 | ⏸ 暂停（`disabled: true`） |

**暂停的实现方式**：`cordis.patch.yml` 里这 4 个 `@deepseek-ai/dsh-tool-subagent` 行**一字未删** ——
`provider` / `toolName` / `persona` 全部原样保留，只额外加一行 `disabled: true`。
Loader 对 `disabled` 行**不实例化、也不校验 config**，所以它们既不进总导演的工具集合，也不会报错、
不会把 preset 打成 `broken`。

被暂停的只是「总导演此刻能不能调用它」，**不是**「这个 Agent 是否存在」：

- 4 个 Agent 的 preset、`persona`/prompt、`SKILL.md`、工具配置**全部保留**，仍可被用户直接选用；
- 恢复方式见本节末尾。

同时给总导演追加了一段**可整段删除**的临时约束（见 [agents/definitions.js](agents/definitions.js) 的
`ZHIRAI_DIRECTOR_TEST_MODE`）：只做文字/剧本创作与项目文件整理，不规划也不承诺图片/视频/配音/音乐/剪辑环节，
不尝试调用已停用的派活通道，不缺工具时**如实说明**而不是伪造产出。

**恢复这 4 个 Agent 的派活**（只需改一处）：

1. 打开 [agents/definitions.js](agents/definitions.js)，把 `ZHIRAI_TOPOLOGY.dispatchEdges` 里对应边的
   `dispatchEnabled: false` 改成 `true`（或直接删掉该键，缺省即启用）；
2. 重跑 `node scripts/build-bundle.mjs` 重新生成 `cordis.patch.yml`；
3. 把新生成的 `cordis.patch.yml` 同步到 Harness 实际加载的插件安装目录，然后重启 Harness。

#### 为什么用 `disabled: true` 而不是删行

`@deepseek-ai/cordis-plugin-loader` 的 `Entry.update()` 对 `disabled` 行**直接返回**：

```js
// step 2: execute
if (this.disabled) { this.fiber?.dispose(); return }   // ← 不 init()，因此也不校验 config
```

由此三点成立（均已在真实运行时验证）：

1. 被禁用的行**不实例化**，其工具不会出现在任何 Agent 的工具目录里；
2. 它的 `config` **不做 schema 校验**，所以「完整保留 provider/toolName/persona + 加一行 `disabled: true`」
   既不会报错，也不会让整个 preset 变成 `broken`；
3. preset 的挂载审计里 `if (entry.disabled) continue`，被禁用的子行不会计入失败行。

#### 暂停后的实测结果（真实 Harness：desktop 同构 profile）

| 检查项 | 结果 |
|---|---|
| 官方 Main Agent | `defaultId = "standard"` ✅ 未被覆盖 |
| registry 行数 | 1（插件仍未声明 `agent-preset-registry`）✅ |
| preset 总数 / `broken` | 10 / 0 ✅ |
| 总导演工具目录（11 个） | `ask_user_question`, `interrupt_agent`, `list_agents`, `send_message`, `spawn_teammate`, `team_task_create`, `team_task_get`, `team_task_list`, `team_task_update`, **`w_dispatch`**, `wait_agent` |
| 派活工具 | `w_dispatch` ✅ 在；`a_/v_/m_/e_dispatch` ✅ 均不在 |
| 4 个被暂停的 Agent | `resolve(zhirai-artist / -voice-actor / -music-composer / -editor)` 全部 OK ✅ |

> 总导演的 system prompt 由 `dsh-persona` 的 `complete: true` 独占（模型只看到这段 prefix），
> 因此追加的「临时测试模式」约束确实会进入模型上下文，不是仅存在于文件里。

#### 文字创作链路端到端实测（真实模型轮）

在真实 Harness 上跑通了本阶段唯一要验的链路，三次完整跑全部 PASS：

| 跳 | 机制 | 证据 |
|---|---|---|
| Harness 官方 Main Agent（`standard`） | 宿主侧 mount（= `dsh-api-session-controller.composeAgent`，与 UI 选择器同一调用） | `composedPreset=standard`，32 个工具，真实模型轮正常 |
| → ZHIRAI 创作总导演 | 同上（跨 preset） | `composedPreset=zhirai-director`，11 个工具 |
| → 编剧（WRITER） | **模型真实调用 `w_dispatch`**（`provider: spawn`） | 父会话 `tool/call name=w_dispatch`；`subagent/catalog childId=f12f2f46-…`；子 Agent persona 实测为 `You are the ZHIRAI screenwriter Agent…` |
| → 项目文件 | 真实落盘 | `01_故事大纲.md` 4769 B（编剧正文逐字）；`02_主Agent归档.md` 4408 B（主 Agent 用自己的 fs 工具归档） |

三次跑分别产出 1099 / 1447 / 1576 字中文故事大纲，题材各异，总导演回复与编剧正文逐字一致 → 真实生成，非模板。

**机制限制（如实记录）**：当前 Harness 的模型可见工具里**没有**「按名字指定 preset」的委派参数
（`subagent` / `subagent_fork` / `spawn_teammate` / `workflow` 的入参中都无 preset 字段）。
因此「standard → 具名 preset」这一跳只能由**用户/宿主侧**发起（UI 预设选择器，或 `agentPresets.select`），
不是模型自主委派。另外 `w_dispatch` 派出的子 Agent 继承的是**父 preset revision**，
其身份由 `w_dispatch` 的 `persona` 覆盖决定 —— 它不是 `zhirai-writer` preset 的一个挂载实例。


每个 Agent 的 `persona.prefix` 是源系统**运行版本 prompt 的原文**（仅把 `{language}` 占位符展开为语言指令）。
逐字一致性由 `scripts/validate-bundle.mjs` 强制校验（与源 `dev.db` 的 `Agent.prompt_template` 逐字比对）。

## 二、目录结构

```
zhirai-short-drama-agents/
├── package.json                 ← bundle manifest（dsh.bundle.patch 指向下方 patch）
├── icon.svg                     ← 插件卡片图标
├── index.js                     ← Host 插件（apply/Config；暴露只读架构服务）
├── cordis.patch.yml             ← 【生成物】1 个 Host 行 + 6 个 agent-preset 声明（不含 agent-preset-registry）
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
| Web 等挂载了 preset 系统的 surface | `cordis.patch.yml` 内的 6 个 `agent-preset` 声明 | 官方 preset 机制 |

### 关于默认 Main Agent（重要）

插件**不声明** `agent-preset-registry`，因此**不会**成为 Harness 的默认 Main Agent：

- `@deepseek-ai/dsh-agent-preset-registry` 的 `config.default` 就是「新会话未显式指定 preset 时使用的 preset id」，
  即 Harness 官方 Main Agent 的身份来源。
- 这条行**由官方 `dsh-web-app` bundle 声明**（`config.default: standard`）。`- insert:` 不做 id 去重，
  插件若再插一条同 id 行，就会在合并后的组合里产生**两条** `agent-preset-registry`；
  而 Loader 的 `EntryGroup` 按 id 建 `store`（后者胜），因此官方那条的配置被整体丢弃，
  `defaultId` 变成插件的 preset —— 这正是「ZHIRAI 抢占默认 Main Agent」的成因。
- 默认 Main Agent 属于**部署方**的选择，插件不得覆盖。删掉这条行后，官方 `standard` 生效；
  本插件 6 个 preset 仍照常注册、仍可被发现与选用（在 Harness 的 Agent 预设名册里位于「自定义」分组）。

> 想在 Harness 里把某个 ZHIRAI Agent 设为默认，用官方的「设为新任务默认」即可（写入
> `agent-preset-registry.selectedDefault`，属于用户偏好，不是插件声明）。

### 修改后的 Agent 层级

```
Harness 官方 Main Agent  —— preset `standard`（部署默认，插件不覆盖）
  └─ ZHIRAI 创作总导演    —— preset `zhirai-director`（普通子 Agent，可被发现/选用）
       ├─ 编剧（WRITER）           preset `zhirai-writer`
       ├─ 画师（ARTIST）           preset `zhirai-artist`
       ├─ 配音师（VOICE_ACTOR）    preset `zhirai-voice-actor`
       ├─ 音乐师（MUSIC_COMPOSER） preset `zhirai-music-composer`
       └─ 剪辑师（EDITOR）         preset `zhirai-editor`
```

6 个 ZHIRAI preset 全部注册在同一个 `agent-preset-registry` 名册里，在 Harness 的 Agent 预设选择器中
位于「自定义」分组（官方 4 个 `standard` / `ptc` / `minimal` / `cordis` 位于「内置」分组）——
因为本插件的 preset 自带 `name`，官方据此把它们判为用户自定义预设。

### 该修改的实测结果（真实 Harness 运行时）

在与 desktop profile **完全相同的 bundle 组合**上启动真实 Harness 并读取活动 registry：

| 项目 | 修改前 | 修改后 |
|---|---|---|
| `agentPresets.defaultId` | `zhirai-director` ❌ | `standard` ✅（官方 Main Agent） |
| 组合里的 `agent-preset-registry` 行数 | 2（官方配置被后者丢弃） | 1 ✅ |
| preset 名册总数 | 10 | 10（无重复、无丢失） |
| ZHIRAI preset | 6 | 6 ✅ |
| `broken` preset | 0 | 0 ✅ |
| `resolve('zhirai-director')` | 成功 | 成功 ✅（仍可被调用） |

> 注意：`node_modules` 里的 bundle patch **不在** Harness HMR 的监听范围内
> （HMR 只监听 profile 的 `cordis.patch.yml` / `package.json`），因此替换插件包后需要**重启 Harness**
> 才能看到上面的改动生效。

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
