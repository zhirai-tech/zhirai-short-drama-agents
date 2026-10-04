/**
 * ZHIRAI 短剧 Agent 插件 —— Agent 架构清单（Host 侧数据源）
 *
 * 来源：源系统 `apps/api/src/modules/agent/default-agents.ts`（源码常量）
 *       与源系统 dev.db 的 `Agent` 表（is_system=1，**运行中**的真实定义）。
 * 二者一致时以 DB 为准 —— DB 是源系统实际服务用户的那一份。
 *
 * 本文件是插件内 Agent 身份/Prompt/Tools/关系/上下文的**唯一数据源**：
 *   - cordis.patch.yml 由它生成（scripts/build-bundle.cjs）
 *   - agents/<id>/SKILL.md 由它生成
 * 因此不存在「手写 YAML 与数据不同步」的问题。
 *
 * 纪律：这里**不重新设计** Agent。role / name / description / prompt / tools
 * 均为源系统原样复制；仅在有明确 adapter 理由时追加字段，并在 ADAPTERS 中说明。
 */

/** 源系统的 prompt 里用的是 `{language}` 占位符；DSH 侧改为等价的语言指令（见 ADAPTERS.languagePlaceholder） */
export const LANGUAGE_DIRECTIVE = 'Reply in the language the user writes in.';

/**
 * ── ZHIRAI 项目固定落盘结构（系统固定行为，不需要用户每次在提示词里描述） ──
 *
 * 这是 ZHIRAI 创作系统对「一个短剧项目」的固定目录契约。
 * 由总导演在**第一次落盘时用 Harness 原生写盘能力真实创建**（`write` 会自动创建父目录）。
 */
export const ZHIRAI_PROJECT_LAYOUT = [
  { dir: '01_项目', holds: '项目定位、故事总纲、分季规划' },
  { dir: '02_人物', holds: '角色设定与角色视觉资产的文字口径' },
  { dir: '03_剧本', holds: '分集剧本、对白、旁白' },
  { dir: '04_分集', holds: '每集卡片与节奏表' },
  { dir: '05_分镜', holds: '分镜与镜头表' },
  { dir: '06_提示词', holds: '图片/视频提示词（本阶段只产出文字）' },
  { dir: '07_制作资源', holds: '制作资源清单（本阶段只登记，不生产）' },
  { dir: '08_执行', holds: '执行状态与进度' },
];

/**
 * ── DIRECTOR preset 的 **mount 行**（Harness 挂载机制要求；**不是**能力白名单） ──
 *
 * 重要区分（本插件架构的核心）：
 *   - **能力发现**（`agents/capability-discovery.js`）：运行时读 Harness 注册表，
 *     回答「当前实际授予本 Agent 什么」。新增能力进入 Runtime 并被授予后自动出现，无需改本插件。
 *   - **mount 行**（本常量）：Harness 要求 preset **显式挂载**某能力行，该 Agent 才看得见它。
 *     这里列的是「必须显式挂载」的那几条，不是「允许使用」的清单。
 *
 * 实测边界（决定了为什么不能只留发现、删掉 mount 行）：
 *   一个零工具行的 preset，调能力发现只会拿到**空目录** —— 发现只能**读取**授权，不能**创造**授权。
 *   所以 mount 行必须保留；而「某能力此刻是否真可用」一律以发现的实时结果为准。
 *
 * 实测根因（当初为什么一条都没有）：agent preset 的 `plugins:` 决定该 Agent 能看到哪些工具；
 * 部署里 `tool-fs` / `tool-fs-search` / `skill-filesystem` / `tool-skill` 这几条 agent-plane 行
 * 被 `dsh-web-app` 的 base 层设为 `disabled: true`，只由各 preset **自己重新挂载**。
 *
 * 这里全是 Harness 官方行，**不新增任何自定义业务工具、不复制 Harness 文件系统实现**：
 *   - `@deepseek-ai/dsh-tool-fs`         → read / write / edit 等真实文件读写（write 自动建父目录）
 *   - `@deepseek-ai/dsh-tool-fs-search`  → 高性能文件搜索（补齐 glob/grep）
 *   - `@deepseek-ai/dsh-tool-skill`      → `skill` 工具：按需加载角色技能正文
 *
 * 两条硬约束：
 *   1. **不要**再加一条 `@deepseek-ai/dsh-skill-filesystem` —— 本 preset 已有 `role-skill` 提供
 *      `filesystem` skill provider，重复会报 `a skill provider named "filesystem" is already
 *      registered in this scope` 并把整个 preset 打成 broken（实测踩过）。
 *   2. **不要**挂 `@deepseek-ai/dsh-fs-local` —— 宿主已挂 `dsh-fs-sandbox`，重复注册 `ctx.fs` 会加载失败。
 */
export const ZHIRAI_DIRECTOR_MOUNT_ROWS = [
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  {
    id: 'tool-fs-search',
    name: '@deepseek-ai/dsh-tool-fs-search',
    // `sampleOverCapGlobResults` 在该 schema 里是 required 且无默认值，必须给。
    config: { sampleOverCapGlobResults: false },
  },
  { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
];

/**
 * ── 临时文字创作测试约束（TEMPORARY · 非源系统 prompt 的一部分） ──
 *
 * 用途：当前阶段只联调「文字创作 / 剧本创作 / 项目文件整理」这条链，
 * 而总导演的四条非 WRITER 派活边已被暂时暂停（见 ZHIRAI_TOPOLOGY.dispatchEdges）。
 * 这里给的是一段**显式、可整段删除**的运行时约束，让总导演在工具缺失时表现得可预期。
 *
 * 纪律：
 *   1. 这段文字**不写回源系统 prompt**，只在生成 bundle 时追加到 DIRECTOR 的 persona 之后；
 *   2. 与源 prompt 原文用醒目的分隔标记隔开，恢复时整段删掉即可；
 *   3. 只陈述「当前可做什么 / 不可做什么 / 不许伪造」，不改变源系统的创作流程与阶段口径。
 *
 * 恢复方式：删除本常量 + build-bundle.mjs 里引用它的那一处（`DIRECTOR_TEST_MODE` 分支）。
 */
export const ZHIRAI_DIRECTOR_TEST_MODE = [
  '',
  '',
  '---',
  '',
  '## 【临时测试模式】当前阶段只做文字创作（本段为临时约束，非系统原设定）',
  '',
  '当前处于**文字创作联调阶段**：只测试「用户 → Harness 主 Agent → 你（总导演）→ 编剧 → 项目文件」这条链路。在这个阶段里：',
  '',
  '- **只执行**文字创作、剧本创作与项目文件整理：故事大纲、完整故事、分集卡、剧本、对白、旁白、分镜文字稿、角色与场景的文字设定。',
  '- **不要主动规划或承诺**图片生成、视频生成、配音、音乐、剪辑这类生产环节；不要在正文里排这些工序的排期。',
  '- 当前**只有派给编剧（WRITER）的通道**可用。**不要尝试调用**已经暂时停用的画师 / 配音师 / 音乐师 / 剪辑师派活通道 —— 它们此刻不在你的工具清单里，调用只会失败。',
  '- 如果用户的需求涉及图片、视频、配音、音乐或剪辑：**先把这一轮能做的文字/剧本部分完整做完**（例如先把该集剧本与分镜文字写完），然后**如实说明**这些视觉/音频环节属于暂停中的能力、当前阶段暂不执行。',
  '- **绝不伪造产出**：不要声称已经生成或已派出图片、视频、音频、成片，也不要用文字假装某个媒体文件已经存在于项目里。没有做就说没做。',
  '- 不要因为缺少这些工具就停下整条链：文字部分的交付要完整、可直接归档进项目文件。',
  '',
  '### ⚠️ 向用户提问：必须调用 Harness 原生 `ask_user_question`（本段为硬要求）',
  '',
  '上面源系统 prompt 里写的 **`ask_user_choice` 工具在当前 Harness 里并不存在**（那是源系统的工具名）。',
  '在 Harness 中，提问的唯一通道是**原生工具 `ask_user_question`**。',
  '',
  '- **需要用户做选择 / 补充信息时，就调用 `ask_user_question` 工具**（你 tool schema 里那个真实的工具）。',
  '  它的参数是 `questions` 数组，每项：`id`（必需，本调用内唯一）、`question`（必需）、可选 `header`、',
  '  可选 `options`（每项 `label` 必需 + 可选 `description`）、可选 `multi_select`。',
  '- **参数名转换**（源 prompt 用的是源系统口径，逐项对应如下）：',
  '  - `title` → **`question`**',
  '  - `options[].id` → 不需要；**直接用 `options[].label`**',
  '  - `options[].label` → **`options[].label`**',
  '  - `options[].description` → **`options[].description`**',
  '  - `selectionMode: "multiple"` → **`multi_select: true`**（单选则省略或 `false`）',
  '  - `maxSelected` / `confirmLabel` / `skipLabel` → 该工具没有这些参数，不要传',
  '- Harness 会把它渲染成**原生问题 UI / 可点击选项**，用户的回答会作为工具结果返回给你，你再继续执行。',
  '- **绝对不要**自己输出工具调用格式的文本（例如 `<function_calls>` / `<invoke …>` / 任何 XML 或 JSON 的 tool-call 原码），',
  '  也**不要**手写 `[CHOICE]…[/CHOICE]` 标记块 —— 这些在 Harness 里都不会被解析，只会作为原码显示给用户。',
  '  源 prompt 里提到这两种“通道”，是因为源系统有对应的解析器；**Harness 没有**，唯一有效的方式就是真正调用 `ask_user_question`。',
  '- 选项请写进 `options`，**不要**在正文里再重复列一遍 A/B/C 或 1/2/3 让用户打字回复。',
  '- 同理，源 prompt 说 `[AWAIT_CONFIRM]` 会变成「确认并继续」按钮 —— **Harness 不解析它**。',
  '  需要用户确认时就用 `ask_user_question` 提问（例如两个选项：继续 / 先调整），不要靠输出标记等按钮。',
  '',
  '### 能力发现：先问 Runtime，不要凭记忆（本段为硬要求）',
  '',
  '你**不应该**依赖任何记忆里的固定工具清单。你的可用能力由 Harness Runtime 在运行时决定，可能随部署变化。',
  '',
  '固定动作顺序：',
  '',
  '1. **收到任务** → 先用 `capabilities` 工具读取「当前 Runtime 实际授予你的能力」（工具 / 技能 / preset / 沙箱策略 / 可见 service）。',
  '2. **判断需要什么** → 按任务需要什么能力，去上一步的结果里找。',
  '3. **有就直接调用** → 用该能力的**原生调用方式**（工具就 tool call；技能用 `skill` 工具加载正文；派活用对应 dispatch 工具）。',
  '4. **没有就如实说** → 清单里没有的能力一律视为**当前不可用**，不要假设、不要硬试、不要用文字假装完成了。',
  '5. **必要时再验证** → 写盘等有副作用的动作必须回读校验（见下节）。',
  '',
  '其它规则：',
  '',
  '- `capabilities` 是**只读**发现入口，输出完全来自 Harness 注册表，不是本项目的固定清单；能力发生变化（新增/被收窄）后重新调用即可拿到最新结果。',
  '- 你**不能**通过任何方式给自己扩权：能不能用某能力由 Harness 的授权与沙箱决定，发现只负责如实报告。',
  '- 被 Harness 拒绝的调用（权限 / 沙箱）→ 把原始错误**照实**报告，并说明这是 Runtime 的授权结果，**不要**绕过、不要换一种说法掩盖。',
  '- 允许派活的角色同样以 `capabilities` 与你自己 tool schema 里**真实存在**的 dispatch 工具为准。',
  '',
  '### 必须真实写盘（本段为硬要求）',
  '',
  '- **「生成了内容」不等于「文件已写入硬盘」。** 本项目所有创作成果都必须用 **write 工具真实写入文件**；只在聊天里输出 Markdown **不算交付**。',
  '- 报告进度时**禁止**出现「已准备 76 份材料」「等待写盘」「已归档」这类没有对应真实文件的说法。只有当场用工具真的写了文件，才能说已落盘。',
  '- 落盘必须走完整闭环，并在回复里给出真实路径：',
  '  1. 用 `write` 写入真实文件（相对路径以本会话工作目录为基准；父目录会自动创建）；',
  '  2. 用 `read` **重新读回**该文件，确认读取成功；',
  '  3. 报告**真实存在的绝对路径**与已知的文件大小；',
  '  4. 读写任一步失败 → **如实说明失败原因**（权限 / 沙箱 / 路径 / 工具缺失），**不要**改用文字假装成功。',
  '- 不允许把「写盘」派给 `w_dispatch` 的子 Agent；子 Agent 负责创作，**写盘由你自己用 write 工具完成**。子 Agent 返回的是文本，不是文件。',
  '- 批量落盘时逐个文件走上面的闭环；不允许一次性宣称写了很多文件却没逐个 `read` 验证过。',
  '- **路径口径**：调用 `write` / `read` 时用**相对路径**（相对本会话的工作目录），工具会在结果里返回**真实绝对路径**；报告时引用工具返回的那个绝对路径，**不要自己猜或编造盘符/目录**。',
  '- 如果 `write` 报错（权限、沙箱、路径不存在等）：把**原始错误**照实转述给用户，不要吞掉，也不要改用「已写入」的说法。',
  '',
  '### 固定项目结构（系统固定行为，不需要用户每次说明）',
  '',
  '每个短剧项目在**会话工作目录**下使用下面这套固定结构。第一次落盘时创建它，之后按此归类，不要另起目录名：',
  '',
  '```',
  '<项目名>/',
  '├─ 01_项目/      项目定位、故事总纲、分季规划',
  '├─ 02_人物/      角色设定与角色视觉资产的文字口径',
  '├─ 03_剧本/      分集剧本、对白、旁白',
  '├─ 04_分集/      每集卡片与节奏表',
  '├─ 05_分镜/      分镜与镜头表',
  '├─ 06_提示词/    图片/视频提示词（本阶段只产出文字）',
  '├─ 07_制作资源/  制作资源清单（本阶段只登记，不生产）',
  '└─ 08_执行/      执行状态与进度',
  '```',
  '',
  '- 目录名逐字使用上面的中文件名；`<项目名>` 用当前项目的实际名字，不要每次都问用户。',
  '',
  '### 单一事实源（Single Source of Truth）',
  '',
  '- **结构化数据只有一个 canonical source**：分镜、分集卡这类结构化内容以 **JSON 文件为唯一事实源**。',
  '- **Markdown 是从 canonical JSON 导出的视图**，用于阅读，不是第二份独立数据；不允许同一结构化内容同时维护两份会各自漂移的副本。',
  '- 不要在 canonical 数据之外再写一份「内容相同但格式不同」的文件来凑数（例如同一分镜既存 MD 又存另一份 JSON）。',
  '- 不要把同一份正文复制到多个目录；只放它真正归属的那一个目录。',
  '- 修改结构化内容时**改 canonical JSON**，需要时再重新导出 MD 视图；不要让 MD 与 JSON 互相矛盾。',
].join('\n');

/**
 * 6 个系统 Agent —— 与源系统 `DEFAULT_SYSTEM_AGENTS` 一一对应，顺序一致。
 * `prompt` 为源系统运行版本原文（已把 `{language}` 展开为 LANGUAGE_DIRECTIVE）。
 * `tools` 为源系统 Agent.tools 原样（空数组 = 该 Agent 在源系统中不启用任何工具）。
 */
export const ZHIRAI_AGENTS = [
  {
    /** DSH 侧 preset id（小写字母/数字/连字符，见 editing-cordis-compositions） */
    presetId: 'zhirai-director',
    /** 源系统 AgentRole 枚举值 —— 保持原样，作为跨系统的稳定标识 */
    role: 'DIRECTOR',
    /**
     * Harness 侧对外显示名（preset config.name）。
     * 源系统里这个 Agent 叫「主创作助手」，但在 Harness 里它是**被官方 Main Agent 调用的子 Agent**，
     * 不是 Main Agent 本身；显示名因此改为「ZHIRAI 创作总导演」，避免与 Harness 主 Agent 身份混淆。
     * 源系统原名不受影响（见 _extracted-agents.json 与 agents/prompts.json 的 sourcePrompt 溯源）。
     */
    name: 'ZHIRAI 创作总导演',
    genre: '综合',
    description: '总调度，可调用所有智能体',
    /** 源系统 Agent.tools 原样 */
    sourceTools: [
      'ask_user_choice',
      'dispatch_agent',
      'recall_project_memory',
      'read_project_content',
      'generate_image',
      'generate_video',
    ],
    /** 该 Agent 在源系统中是否具备工具调用循环（仅 DIRECTOR） */
    toolCalling: true,
    /** 可被用户直接选用（源系统里 Director 是对话入口） */
    userFacing: true,
    /** 源系统里该 Agent 通过 dispatch_agent 可派活的目标角色 */
    dispatches: ['WRITER', 'ARTIST', 'VOICE_ACTOR', 'MUSIC_COMPOSER', 'EDITOR'],
    /** 该 Agent 承载的生产阶段（源系统 TEXT_MATRIX_STAGE_ORDER 中的 stage） */
    stages: ['MAIN', 'DIRECTOR'],
    /** roster 顺序（对应源系统里 Director 是总控） */
    order: 1,
    prompt: '', // 由 _extracted-agents.json 注入（保持本文件可读；见 loadAgents()）
  },
  {
    presetId: 'zhirai-writer',
    role: 'WRITER',
    name: '编剧',
    genre: '综合',
    description: '剧本创作 & 场景对白 & 分镜规划',
    sourceTools: [],
    toolCalling: false,
    userFacing: true,
    dispatches: [],
    stages: ['STORY', 'SCRIPT', 'STORYBOARD'],
    order: 2,
    prompt: '',
  },
  {
    presetId: 'zhirai-artist',
    role: 'ARTIST',
    name: '画师',
    genre: '综合',
    description: '角色定妆照 & 场景背景图生成（按需产出完整角色视觉资产：三视图/半身图/细节图）',
    sourceTools: [],
    toolCalling: false,
    userFacing: true,
    dispatches: [],
    stages: ['CHARACTER', 'SCENE', 'STORYBOARD', 'IMAGE_PROMPT'],
    order: 3,
    prompt: '',
  },
  {
    presetId: 'zhirai-voice-actor',
    role: 'VOICE_ACTOR',
    name: '配音师',
    genre: '综合',
    description: '角色语音合成 & 旁白朗读',
    sourceTools: [],
    toolCalling: false,
    userFacing: true,
    dispatches: [],
    stages: ['VOICE'],
    order: 4,
    prompt: '',
  },
  {
    presetId: 'zhirai-music-composer',
    role: 'MUSIC_COMPOSER',
    name: '音乐师',
    genre: '综合',
    description: '背景音乐生成 & 混音',
    sourceTools: [],
    toolCalling: false,
    userFacing: true,
    dispatches: [],
    stages: ['MUSIC'],
    order: 5,
    prompt: '',
  },
  {
    presetId: 'zhirai-editor',
    role: 'EDITOR',
    name: '剪辑师',
    genre: '综合',
    description: '视频合成 & 超分增强 & 输出',
    sourceTools: [],
    toolCalling: false,
    userFacing: true,
    dispatches: [],
    stages: ['VIDEO_PROMPT', 'VIDEO'],
    order: 6,
    prompt: '',
  },
];

/**
 * Agent 之间的调度关系（源系统真实调用关系，不是示意）。
 *
 * 事实来源：
 * - `chat.service.buildDirectorTools()` 的 `dispatch_agent`（role 枚举 = 5 个执行角色）
 * - `agent-capability.TOOL_CALLING_ROLES = ['DIRECTOR']`（只有 Director 有工具循环）
 * - `agent-capability.AGENT_ROLE_TO_CORE_KEYS`（角色 → 生产 stage 的记忆范围）
 * - `textmatrix/text-matrix.registry.ts` 的 STAGE_AGENTS 上下游（inputLabel 显式声明）
 */
export const ZHIRAI_TOPOLOGY = {
  /** 总控：唯一具备工具调用循环、唯一可派活 */
  root: 'DIRECTOR',
  /**
   * 调度边：Director → 执行角色。
   *
   * `dispatchEnabled` 是**临时暂停开关**（不是删除开关，更不是废弃标记）：
   *   - `true`（默认，缺省即启用）：该派活工具挂载到 Director 的 preset 上，Director 可调用。
   *   - `false`：该派活工具**仍然声明**在 preset 里、仍然完整生成，只额外带 `disabled: true`，
   *     因此不进入 Director 可调用的工具集合 —— 目标角色 Agent 本身、其 persona/prompt、
   *     其工具配置与生成文件全部保持完整。
   *
   * 暂停的只是「总导演此刻能不能调用它」，不是「这个 Agent 是否存在」。
   * 恢复方式：把对应边的 `dispatchEnabled` 改回 `true`（或删掉该键）并重跑 build-bundle.mjs。
   *
   * 当前阶段（文字创作联调）只放行 WRITER，其余四边暂停 —— 见 ZHIRAI_DIRECTOR_TEST_MODE。
   */
  dispatchEdges: [
    { from: 'DIRECTOR', to: 'WRITER', via: 'dispatch_agent', tool: 'w_dispatch', dispatchEnabled: true },
    { from: 'DIRECTOR', to: 'ARTIST', via: 'dispatch_agent', tool: 'a_dispatch', dispatchEnabled: false },
    { from: 'DIRECTOR', to: 'VOICE_ACTOR', via: 'dispatch_agent', tool: 'v_dispatch', dispatchEnabled: false },
    { from: 'DIRECTOR', to: 'MUSIC_COMPOSER', via: 'dispatch_agent', tool: 'm_dispatch', dispatchEnabled: false },
    { from: 'DIRECTOR', to: 'EDITOR', via: 'dispatch_agent', tool: 'e_dispatch', dispatchEnabled: false },
  ],
  /** 文本生产阶段的数据流（源系统 STAGE_AGENTS 的 inputLabel 原文口径） */
  stagePipeline: [
    { stage: 'MAIN', agent: 'DIRECTOR', input: '用户 Topic + 项目上下文' },
    { stage: 'DIRECTOR', agent: 'DIRECTOR', input: '上游 MAIN plan + 用户 Topic + 检索到的领域/风格 Intelligence + 用户/项目经验' },
    { stage: 'STORY', agent: 'WRITER', input: '上游 MAIN plan + 用户 Topic + 项目/记忆上下文' },
    { stage: 'SCRIPT', agent: 'WRITER', input: '上游 STORY 结果' },
    { stage: 'CHARACTER', agent: 'ARTIST', input: '上游 SCRIPT（含 STORY 设定的角色）' },
    { stage: 'SCENE', agent: 'ARTIST', input: '上游 SCRIPT + CHARACTER' },
    { stage: 'STORYBOARD', agent: 'WRITER', input: '上游 SCRIPT + CHARACTER + SCENE' },
    { stage: 'IMAGE_PROMPT', agent: 'ARTIST', input: '上游 CHARACTER + SCENE + STORYBOARD/SHOT' },
    { stage: 'VIDEO_PROMPT', agent: 'EDITOR', input: '上游 SHOT + IMAGE_PROMPT + CHARACTER/SCENE' },
  ],
  /** 主链路阶段顺序（源系统 MAIN_STAGE_ORDER） */
  mainStageOrder: ['OUTLINE', 'STORY', 'SCRIPT', 'CHARACTER', 'SCENE', 'VOICE', 'STORYBOARD', 'IMAGE', 'VIDEO'],
  /** 阶段中文标签（源系统 STAGE_LABELS） */
  stageLabels: {
    OUTLINE: '故事大纲',
    STORY: '完整故事',
    SCRIPT: '完整剧本',
    CHARACTER: '角色设计',
    SCENE: '场景设计',
    VOICE: '音频（配音配乐）',
    STORYBOARD: '分镜脚本',
    IMAGE: '图片素材',
    VIDEO: '视频成片',
  },
};

/**
 * 源系统 Agent 依赖的上下文（源系统真实读取的上下文来源）。
 * 用途：插件把这些映射到 DSH 的等价机制，而不是把源系统数据库搬过来。
 */
export const ZHIRAI_CONTEXT_NEEDS = [
  { need: 'conversation context', source: '会话消息历史', dshMechanism: 'Session 消息历史（Harness 原生）' },
  { need: 'project context', source: 'Project + Project.description + Workspace 文件', dshMechanism: 'Workspace 文件（dsh-tool-fs / workspaceFiles）' },
  { need: 'story context', source: '02_完整故事.md（Workstream 文件即事实源）', dshMechanism: 'Workspace 文件读取' },
  { need: 'character context', source: '角色 canonical（DB）＋定妆资产', dshMechanism: 'Workspace 文件 + Skills（zhirai-artist）' },
  { need: 'scene context', source: '场景设计（DB/文件）', dshMechanism: 'Workspace 文件 + Skills' },
  { need: 'production context', source: 'ProductionState / ProductionTask（DB）', dshMechanism: 'Skill 记录口径 + Workspace 文件（**不搬 DB**）' },
  { need: 'memory/context references', source: 'ProjectMemory / UserMemory（recall_project_memory）', dshMechanism: 'Workspace 文件（**能力缺口，见 ADAPTERS**）' },
];

/** 源系统工具 → DSH 机制的映射（adapter 说明；**不假装等价**） */
export const TOOL_ADAPTERS = [
  {
    source: 'dispatch_agent',
    dsh: 'ctx.subagents（@deepseek-ai/dsh-subagent + @deepseek-ai/dsh-tool-subagent 多实例）',
    status: 'MAPPED',
    note: '源系统一个 dispatch_agent(role, task)；DSH 是每角色一个具名 provider 实例（w_dispatch/a_dispatch/v_dispatch/m_dispatch/e_dispatch）。语义等价：Director 派活、执行体返回结果。',
  },
  {
    source: 'ask_user_choice',
    dsh: '@deepseek-ai/dsh-tool-ask-user（ctx.userQuestions seam）',
    status: 'MAPPED',
    note: '源系统刚完成的「答题板」结构化选择；DSH 已有等价机制（ask_user_question 工具 + user-questions seam）。插件不复用源系统实现。',
  },
  {
    source: 'recall_project_memory',
    dsh: 'Workspace 文件读取（无 vector/记忆库 seam）',
    status: 'GAP',
    note: '真实能力缺口：源系统有 ProjectMemory/UserMemory 检索，DSH 无对应 provider seam。插件**不伪造**该工具；记忆改由 Workspace 文件 + Skill 口径承担。',
  },
  {
    source: 'read_project_content',
    dsh: '@deepseek-ai/dsh-tool-fs / workspaceFiles（Workspace 文件读取）',
    status: 'MAPPED',
    note: '源系统按路径/关键词回查项目文件；DSH 直接读 Workspace 文件，语义更直接。',
  },
  {
    source: 'generate_image',
    dsh: '**不由插件提供** —— 由 Harness 的模型/工具系统按能力选择（见 MODEL_BINDING）',
    status: 'HOST-PROVIDED',
    note: '源系统工具内部走 ModelManager → Provider。DSH 侧插件不绑定任何图片模型；能力需求由 Agent 表达、由 Harness 解析。',
  },
  {
    source: 'generate_video',
    dsh: '**不由插件提供** —— 同上',
    status: 'HOST-PROVIDED',
    note: '同上；LTX/ComfyUI 等具体供应商属于源系统生产层，本阶段不复制。',
  },
];

/**
 * 模型绑定策略（对应任务书 §八/§九）。
 * 插件**不**声明任何 provider/model；模型由 Harness 的 Agent 默认模型与模型选择器决定。
 */
export const MODEL_BINDING = {
  policy: 'HOST-MANAGED',
  declaredProviders: [],
  declaredModels: [],
  note:
    '插件不写死任何模型/供应商。每个 preset 只声明 persona + skills；实际模型来自 Harness 的 ' +
    '@deepseek-ai/dsh-agent-default-model 与用户在当前 Session 的模型选择（dsh-client-ui-model-selection）。' +
    '因此换模型不需要改插件。',
};
