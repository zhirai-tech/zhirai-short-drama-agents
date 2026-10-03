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
    name: '主创作助手',
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
  /** 调度边：Director → 执行角色 */
  dispatchEdges: [
    { from: 'DIRECTOR', to: 'WRITER', via: 'dispatch_agent', tool: 'w_dispatch' },
    { from: 'DIRECTOR', to: 'ARTIST', via: 'dispatch_agent', tool: 'a_dispatch' },
    { from: 'DIRECTOR', to: 'VOICE_ACTOR', via: 'dispatch_agent', tool: 'v_dispatch' },
    { from: 'DIRECTOR', to: 'MUSIC_COMPOSER', via: 'dispatch_agent', tool: 'm_dispatch' },
    { from: 'DIRECTOR', to: 'EDITOR', via: 'dispatch_agent', tool: 'e_dispatch' },
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
