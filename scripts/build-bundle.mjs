/**
 * 生成插件产物：cordis.patch.yml / agents/<preset>/SKILL.md / locale/*.json / agents/prompts.json
 *
 * 数据源：
 *   1) _extracted-agents.json —— 从源系统 dev.db 的 Agent 表（is_system=1）导出的**运行中**定义
 *   2) agents/definitions.js —— 身份/关系/工具映射（含源系统原文）
 *
 * 为什么用脚本生成而不是手写 YAML：避免「patch 与真实定义不同步」。
 * 生成物是安装产物，脚本是唯一写入者；改定义 = 改 definitions.js + 重跑本脚本。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZHIRAI_AGENTS, ZHIRAI_TOPOLOGY, LANGUAGE_DIRECTIVE, ZHIRAI_DIRECTOR_TEST_MODE, ZHIRAI_DIRECTOR_MOUNT_ROWS } from '../agents/definitions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** 本插件在 profile 里的安装名（profile package.json 的 dependencies key） */
const PACKAGE_NAME = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;

/**
 * DSH Cordis Loader 的 `!!js` 求值器是 `new Function('ctx','expr','with (ctx) { return eval(expr) }')`，
 * 因此表达式里**没有模块作用域**：`import.meta` / `__dirname` / `require` 都不可用
 * （实测 `import.meta.url` → "Cannot use 'import.meta' outside a module"）。
 *
 * 可用的东西：
 *   - 行作用域上的 `baseUrl`：该 profile 根目录的 file URL
 *     （`dsh-app-boot` 的 `boot()` 设置 ctx.baseUrl = dirname(configPath) 的 URL；Loader 把它继承给每个 entry）
 *   - Node 全局 `process`（含 `process.getBuiltinModule`）
 *
 * 于是用 profile 根目录作为 require 锚点解析本插件自己的 package.json，
 * 再取其目录 + `agents/<presetId>` —— 与安装方式是 link / 目录 / 真实目录无关。
 */
const skillDirExpr = (presetId) =>
  "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(" +
  "process.getBuiltinModule('node:module').createRequire(" +
  "process.getBuiltinModule('node:url').fileURLToPath(new URL('package.json', baseUrl))" +
  `).resolve(${JSON.stringify(`${PACKAGE_NAME}/package.json`)}))` +
  `, 'agents', ${JSON.stringify(presetId)})`;

/** 源系统 prompt 用 `{language}` 占位符；DSH 侧展开为语言指令 */
const expandLanguage = (prompt) => String(prompt).split('{language}').join(LANGUAGE_DIRECTIVE);

const extracted = JSON.parse(fs.readFileSync(path.join(root, '_extracted-agents.json'), 'utf8'));
const byRole = new Map(extracted.map((a) => [a.role, a]));

// ── 校验：6 个 Agent 必须都能拿到**非空**的源系统原文 ──
const problems = [];
for (const a of ZHIRAI_AGENTS) {
  const src = byRole.get(a.role);
  if (!src) problems.push(`${a.role}: 源导出中缺失`);
  else if (!src.prompt || !src.prompt.trim()) problems.push(`${a.role}: 源 prompt 为空`);
}
if (problems.length) {
  console.error('❌ 源定义不完整，拒绝生成：\n  ' + problems.join('\n  '));
  process.exit(1);
}

const agents = ZHIRAI_AGENTS.map((a) => {
  const src = byRole.get(a.role);
  return {
    ...a,
    sourceAgentId: src.id,
    prompt: expandLanguage(src.prompt),
    sourcePrompt: src.prompt,
  };
});

/**
 * DIRECTOR 的 persona：源 prompt 原文 + 临时测试模式约束（后者只在 bundle 里追加，不写回源定义）。
 * 其余 Agent 原样使用源 prompt。
 */
const personaFor = (a) => (a.role === 'DIRECTOR' ? a.prompt + ZHIRAI_DIRECTOR_TEST_MODE : a.prompt);

/** 暂停中的派活边（`dispatchEnabled === false`）。缺省视为启用。 */
const pausedEdges = ZHIRAI_TOPOLOGY.dispatchEdges.filter((e) => e.dispatchEnabled === false);

// ── 1. prompts.json（完整原文，供审计与在 Harness 里查看） ──
fs.writeFileSync(
  path.join(root, 'agents', 'prompts.json'),
  JSON.stringify(
    {
      generatedFrom: {
        source: 'apps/api/src/modules/agent/default-agents.ts + dev.db Agent(is_system=1)',
        agents: agents.map((a) => ({ role: a.role, sourceAgentId: a.sourceAgentId, promptLength: a.sourcePrompt.length })),
      },
      note: 'prompt 为源系统运行版本原文；仅把 {language} 占位符展开为语言指令（见 ADAPTERS.languagePlaceholder）。effectivePrompt = bundle 里 DIRECTOR persona 实际使用的文本（源 prompt + 可整段删除的临时测试模式约束）；其余 Agent 两者相同。',
      temporaryPause: {
        why: '当前阶段只联调文字创作链路（用户 → Harness 主 Agent → 总导演 → 编剧 → 项目文件），因此暂停总导演对其余四条派活边的调用。',
        pausedDispatchEdges: ZHIRAI_TOPOLOGY.dispatchEdges
          .filter((e) => e.dispatchEnabled === false)
          .map((e) => ({ tool: e.tool, to: e.to })),
        activeDispatchEdges: ZHIRAI_TOPOLOGY.dispatchEdges
          .filter((e) => e.dispatchEnabled !== false)
          .map((e) => ({ tool: e.tool, to: e.to })),
        mechanism: 'preset 内对应的 @deepseek-ai/dsh-tool-subagent 行保留完整声明，仅加 disabled: true（Loader 不实例化、不校验 config）。',
        restore: 'agents/definitions.js 的 ZHIRAI_TOPOLOGY.dispatchEdges 里把该边 dispatchEnabled 改回 true（或删掉该键），重跑 scripts/build-bundle.mjs。',
        note: '被暂停的四个 Agent（ARTIST / VOICE_ACTOR / MUSIC_COMPOSER / EDITOR）本体、persona/prompt、skill 目录与生成文件全部保留，未被删除或禁用。',
      },
      agents: agents.map((a) => ({
        role: a.role,
        presetId: a.presetId,
        name: a.name,
        description: a.description,
        sourceTools: a.sourceTools,
        sourcePrompt: a.sourcePrompt,
        prompt: a.prompt,
        effectivePrompt: personaFor(a),
      })),
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`✓ prompts.json（${agents.length} 个 Agent）`);

// ── 2. agents/<id>/SKILL.md（Agent 记忆范围：源系统 AGENT_ROLE_TO_CORE_KEYS + STAGE_AGENTS 职责原文） ──
const STAGE_DUTY = {
  MAIN: '理解用户目标，做小规模生产规划（1 集、短剧），确定体裁/基调/节奏/交付物范围，并把生产拆解交给专业 Agent 逐级完成。不要代替后续专业 Agent 生成完整正文。',
  DIRECTOR:
    '读取 Main 的项目目标与用户需求，动态判断项目类型，检索并综合相关领域/风格 Knowledge、导演生产经验、用户偏好与项目经验，形成可执行的导演级生产策略（项目类型/体裁组合/视觉语言/创作支柱/一致性规则/镜头节奏风格）。不代写完整正文。',
  STORY: '负责故事层：世界观、故事核心、主线、冲突、结构、叙事方向。只做故事设计，不写剧本正文。',
  SCRIPT: '负责把 Story 转为短剧本：分场、对白、动作、叙事、剧情推进、节奏。',
  CHARACTER: '负责从 Story + Script 提炼结构化角色：身份/性格/外观/关系/行为特征/一致性要求。',
  SCENE: '负责场景层：从 Script 提炼/定义场景环境、时间、空间关系、场景连续性。',
  STORYBOARD: '负责分镜与镜头：把 Script + Scene + Character 拆成 Shot；明确景别/运镜/构图/人物动作/对白/时长/镜头顺序。',
  IMAGE_PROMPT: '只负责「图片提示词」文本：根据 Character/Scene/Shot 真实内容生成保持一致的执行级 Image Prompt。禁止调用图片模型。',
  VIDEO_PROMPT: '只负责「视频提示词」文本：根据 Shot + Image Prompt 预期 + Character/Scene 生成执行级 Video Prompt，含镜头运动/动作/时间/节奏/连续性/参考资产要求。禁止调用视频模型。',
  VOICE: '角色语音合成与旁白朗读，区分对白配音与旁白语气。',
  MUSIC: '按剧情情绪节奏生成背景音乐与混音。',
  VIDEO: '视频合成、镜头转场、超分增强与最终输出。',
};

for (const a of agents) {
  const dir = path.join(root, 'agents', a.presetId);
  fs.mkdirSync(dir, { recursive: true });
  const stageLines = a.stages
    .map((s) => `- **${s}**${ZHIRAI_TOPOLOGY.stageLabels[s] ? `（${ZHIRAI_TOPOLOGY.stageLabels[s]}）` : ''}：${STAGE_DUTY[s] || ''}`)
    .join('\n');
  const dispatchLines = a.dispatches.length
    ? a.dispatches.map((r) => `- ${r}`).join('\n')
    : '- （本角色不派活；它是被 Director 派活的执行体）';
  const md = `---
name: ${a.presetId}
description: ${a.name}（${a.role}）的职责与生产阶段口径 —— 复制自 ZHIRAI 短剧系统的 ${a.role} Agent。当任务属于这些阶段时加载本技能。
---

# ${a.name}（${a.role}）

来源：ZHIRAI 短剧系统 \`Agent\` 表（is_system=1）中 role=${a.role} 的运行中定义。

## 职责（源系统原文）

${a.description}

## 生产阶段口径（源系统 TEXT_MATRIX_STAGE_ORDER + STAGE_AGENTS.duty 原文）

${stageLines}

## 调度关系（源系统真实调用关系）

- 上游：${a.role === 'DIRECTOR' ? '用户请求 / MAIN 规划' : 'DIRECTOR 通过 dispatch_agent 派活'}
- 下游：${a.dispatches.length ? '见下' : '回报给 DIRECTOR'}
${dispatchLines}

## 上下文（该角色正常工作所需，源系统真实读取）

${ZHIRAI_TOPOLOGY.stagePipeline
  .filter((p) => p.agent === a.role)
  .map((p) => `- ${p.stage}：${p.input}`)
  .join('\n') || '- 由 DIRECTOR 在派活时提供所需上下文'}

## 纪律

- 不代写其他角色的产出；产出交回 DIRECTOR。
- 不伪造产出：没有真实模型结果时就如实说明，不要用文字假装已生成。
- 模型由 Harness 选择；本角色不指定具体模型/供应商。
`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md, 'utf8');
}
console.log(`✓ agents/*/SKILL.md（${agents.length} 个）`);

// ── 3. locale（插件卡片显示元数据） ──
const localeDir = path.join(root, 'locale');
fs.mkdirSync(localeDir, { recursive: true });
const zh = {
  title: 'ZHIRAI 短剧创作 Agent 组',
  description: `复制自 ZHIRAI AI 短剧系统的完整 Agent 架构：${agents.length} 个 Agent（${agents
    .map((a) => a.name)
    .join('、')}），含总控派活关系与生产阶段口径。`,
};
const en = {
  title: 'ZHIRAI Short-Drama Agent Crew',
  description: `The complete agent architecture copied from the ZHIRAI AI short-drama system: ${agents.length} agents (${agents
    .map((a) => a.role)
    .join(', ')}), with the dispatcher topology and production-stage contracts.`,
};
fs.writeFileSync(path.join(localeDir, 'zh.json'), JSON.stringify(zh, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(localeDir, 'en.json'), JSON.stringify(en, null, 2) + '\n', 'utf8');
console.log('✓ locale/{zh,en}.json');

// ── 4. cordis.patch.yml（preset 声明 + Host 插件行） ──
/** YAML 里提示词用块标量，避免提示词里的引号/冒号破坏 YAML */
const blockScalar = (text, indent) => {
  const pad = ' '.repeat(indent);
  return '|-\n' + text.split('\n').map((l) => (l.length ? pad + l : '')).join('\n');
};

let yml = '';
yml += '# 本文件由 scripts/build-bundle.mjs 从 definitions.js + _extracted-agents.json 生成 —— 请勿手改。\n';
yml += '# 内容：1) Host 插件行（插件可见/可管理）  2) 每个 ZHIRAI Agent 一个 @deepseek-ai/dsh-agent-preset 声明\n';
yml += '# 刻意**不含** agent-preset-registry：默认 Main Agent 属于部署方（dsh-web-app 的 default: standard），\n';
yml += '# 插件覆盖它会抢占 Harness 官方 Main Agent 的主位（详见下方行内注释）。\n';
yml += '#\n';
yml += '# 当前临时状态：DIRECTOR 的 a_/v_/m_/e_dispatch 派活工具带 `disabled: true`（暂时不挂载，行本身完整保留），\n';
yml += '# 只放行 w_dispatch。四个目标 Agent 的定义/persona/skill 全部保留 —— 见 ZHIRAI_TOPOLOGY.dispatchEdges。\n';
yml += '#\n';
yml += '# 生成依据（源系统事实）：\n';
yml += '#   apps/api/src/modules/agent/default-agents.ts  —— 6 个系统 Agent 的身份与 prompt\n';
yml += '#   dev.db Agent(is_system=1)                     —— 运行中的 prompt 与 tools（本 patch 采用这一份）\n';
yml += '#   agent-capability.ts                           —— TOOL_CALLING_ROLES / AGENT_ROLE_TO_CORE_KEYS / 工具目录\n';
yml += '#   textmatrix/text-matrix.registry.ts            —— 8 个生产阶段的职责与上下游\n';
yml += '#   creative/production-stage.ts                  —— MAIN_STAGE_ORDER 主链路阶段顺序\n';
yml += '\n';
yml += '- insert:\n';
yml += '    # ── Host 插件行：让插件本体出现在 Harness 插件管理里（可禁用、可查看元数据） ──\n';
yml += '    - id: zhirai-short-drama-agents\n';
yml += "      name: '@local/zhirai-short-drama-agents'\n";
yml += '      config:\n';
yml += '        languageDirective: ' + JSON.stringify(LANGUAGE_DIRECTIVE) + '\n';
yml += '\n';
yml += '    # ── 本插件**不**声明 agent-preset-registry ──\n';
yml += '    # 历史上这里插入过一条 `- id: agent-preset-registry` / `config.default: zhirai-director`，\n';
yml += '    # 目的只是让 Web 的 preset 选择器默认选中 Director。但 `@deepseek-ai/dsh-agent-preset-registry`\n';
yml += '    # 是**部署级单例服务**（`provide()` 同名二次注册会抛 "service ... has been registered"），\n';
yml += '    # 官方 `dsh-web-app` bundle 已经声明了这条行（default: standard）。本插件再插一条同名行会：\n';
yml += '    #   1) 在合并后的组合里产生**两条** agent-preset-registry 行；\n';
yml += '    #   2) 让官方那条 mount 失败，本插件这条拿到服务，于是 `defaultId` 变成 zhirai-director，\n';
yml += '    #      抢占 Harness 官方 Main Agent 的主位。\n';
yml += '    # 结论：默认 Main Agent 是**部署方**的选择，插件不得覆盖。删掉这条行后，官方\n';
yml += '    # `dsh-web-app` 的 `default: standard` 生效；本插件的 6 个 preset 仍照常注册，\n';
yml += '    # 仍可被发现与选用，只是不再自称默认。\n';
yml += '\n';
yml += '    # ── Agent 声明：源系统 6 个系统 Agent，一人一个 preset ──\n';
for (const a of agents) {
  yml += `    # ${a.name}（${a.role}）· 源 Agent.id=${a.sourceAgentId} · 源 prompt ${a.sourcePrompt.length} 字\n`;
  yml += `    - id: preset-${a.presetId}\n`;
  yml += "      name: '@deepseek-ai/dsh-agent-preset'\n";
  yml += '      config:\n';
  yml += `        id: ${a.presetId}\n`;
  // Director 的对外显示名**逐字**用 a.name（「ZHIRAI 创作总导演」），不加角色后缀：
  // 它在 Harness 里是被官方 Main Agent 调用的子 Agent，显示名必须与 Main Agent 明确区分。
  // 其余 5 个执行角色沿用「名称（ROLE）」形式，保持与源系统一致的识别度。
  yml += `        name: ${JSON.stringify(a.role === 'DIRECTOR' ? a.name : `${a.name}（${a.role}）`)}\n`;
  yml += `        description: ${JSON.stringify(a.description)}\n`;
  yml += `        order: ${a.order}\n`;
  yml += '        plugins:\n';
  yml += '          # 身份：源系统该 Agent 的 system prompt 原文（{language} 已展开）\n';
  yml += '          - id: persona\n';
  yml += "            name: '@deepseek-ai/dsh-persona'\n";
  yml += '            config:\n';
  // DIRECTOR 的 persona 用 `complete: true`，会丢掉 suffix（部署把 cwd 提示放在 suffix 里），
  // 因此在 prefix 里自己声明一次工作目录，让模型**一开场**就知道绝对 cwd，不必猜落盘位置。
  //
  // 关于 `{{cwd}}` 的实测结论（两处证据，曾一度误判）：
  //   - `systemPrompt.assemble()` 返回的 section.text 里仍是**字面** `{{cwd}}`（未插值）；
  //   - 但**真正发给模型**的 `system/message` 事件里已是**渲染后的绝对路径**
  //     （实测：`Your working directory is C:/Users/.../project.`）。
  // 即插值发生在 assemble 之后的渲染阶段，所以 prefix 里可以安全使用 `{{cwd}}`；
  // 判断这类问题必须以 `system/message`（真实请求）为准，不能只看 assemble() 的返回值。
  yml += '              prefix: ' + blockScalar(a.role === 'DIRECTOR' ? `Your working directory is {{cwd}}.\n\n${personaFor(a)}` : personaFor(a), 16) + '\n';
  yml += '              complete: true\n';
  yml += '              includeRuntimeContext: false\n';
  yml += '          # 记忆范围 / 生产阶段口径：源系统该角色的 stage 职责\n';
  yml += '          - id: role-skill\n';
  yml += "            name: '@deepseek-ai/dsh-skill-filesystem'\n";
  yml += '            config:\n';
  // DIRECTOR 只保留本插件自带的角色技能（includeDefaultRoots: false），避免把宿主/用户目录下的
  // 无关技能拉进 ZHIRAI 会话。**不要**因此再挂第二条 skill-filesystem —— 同一 scope 内
  // 一个 `filesystem` skill provider 只能有一条，重复会报错并把整个 preset 打成 broken（实测踩过）。
  yml += `              includeDefaultRoots: ${a.role === 'DIRECTOR' ? 'false' : 'true'}\n`;
  yml += `              # !!js 由 DSH Cordis Loader 在行激活时求值（无模块作用域，不能写 import.meta）；\n`;
  yml += `              # 表达式用行作用域的 baseUrl（profile 根）反查本插件自己的安装目录。\n`;
  yml += `              customSkillDirs:\n`;
  yml += `                - !!js ${skillDirExpr(a.presetId)}\n`;
  if (a.role === 'DIRECTOR') {
    // ── 能力发现：ZHIRAI 不再把「有哪些工具」当作需要自己维护的知识 ──
    // 挂一个极薄的 Capability Discovery Adapter（本插件模块，见 agents/capability-discovery.js）。
    // 它在运行时直接读 Harness 官方注册表，报告「当前实际授予本 Agent 的能力」：
    //   ctx.tools.schemas(exec.agent) / ctx.skills.list({scope}) / ctx.agentPresets.list() / ctx.sandboxPolicy.resolve()
    // 于是新增能力（新 tool / 新 MCP / 新 skill / 新 preset）进入 Runtime 并被授予本 Agent 后，
    // ZHIRAI 无需改代码即可发现，并按能力原生调用方式使用。
    //
    // ⚠️ 实测要点 1（本设计的前提边界）：发现只能**读取**、不能**创造**授权。
    //    `ctx.tools.schemas()` 不传 scope 只返回宿主 global 层；在 preset 作用域里实测 count=0。
    //    必须传查看者 Agent 对象本身（exec.agent）；实测同一 agent 得到 13 个工具。
    //    另外「没有挂载就没有能力」：一个零工具行的 preset 调发现只会得到空目录 ——
    //    所以下面几条 mount 行是 **Harness 挂载机制的要求**，不是 ZHIRAI 的能力白名单。
    //    一个能力是否真的可用，最终以 discovery 的实时结果为准。
    // ⚠️ 实测要点 2：perset 子树 `provide()` 服务到 root realm 会 `Preset services require isolate realms`
    //    导致整个 preset mount 失败；本适配器只**读**宿主服务，不提供任何服务。
    // ⚠️ 实测要点 3：同一个 preset 里 `@deepseek-ai/dsh-skill-filesystem` 只能有一条
    //    （重复会 `a skill provider named "filesystem" is already registered in this scope`）。
    yml += '          # ── 能力发现（运行时读取 Harness 授予本 Agent 的能力；非静态白名单）──\n';
    yml += '          - id: capability-discovery\n';
    yml += `            name: ${JSON.stringify(`${PACKAGE_NAME}/agents/capability-discovery.js`)}\n`;
    yml += '          # ── 以下 mount 行：Harness 要求 preset 显式挂载才可见（不是能力白名单）──\n';
    yml += '          # 这些 agent-plane 行在部署里被 dsh-web-app 的 base 层 disabled，只有 preset 自己挂载才可见；\n';
    yml += '          # 宿主侧 ctx.fs / fs-sandbox / sandbox-policy 已存在，挂上即真实可用。\n';
    yml += '          # 是否真可用以 capability-discovery 的实时结果为准；被 Harness restrict 掉的能力会自动消失。\n';
    // ── Harness 原生文件能力：让「文字创作 → 真实 Windows 文件系统」闭环成立 ──
    // 全是官方行（read/write/edit/glob/grep + skill 加载），不自造文件系统、不新增自定义工具。
    // 不要挂 @deepseek-ai/dsh-fs-local（宿主已挂 dsh-fs-sandbox，重复注册 ctx.fs 会加载失败）。
    yml += '          # write 会自动创建父目录；相对路径以本会话 cwd 为基准。\n';
    // ── mount 行清单：Harness 的挂载机制要求，与「能力发现」分工不同 ──
    // 加新能力时通常**不需要**改这里：只要该能力进入 Runtime 并被授予本 Agent，
    // discovery 就会自动报告。只有在「新能力需要 preset 显式挂载」时才需要加一行。
    for (const row of ZHIRAI_DIRECTOR_MOUNT_ROWS) {
      yml += `          - id: ${row.id}\n`;
      yml += `            name: ${JSON.stringify(row.name)}\n`;
      if (row.config) {
        yml += '            config:\n';
        for (const [k, v] of Object.entries(row.config)) {
          if (Array.isArray(v)) {
            if (v.length === 0) {
              yml += `              ${k}: []\n`;
            } else {
              yml += `              ${k}:\n`;
              for (const item of v) yml += `                - ${JSON.stringify(item)}\n`;
            }
          } else {
            yml += `              ${k}: ${JSON.stringify(v)}\n`;
          }
        }
      }
    }
    yml += '          # 结构化提问：让用户做选择（源系统 ask_user_choice 的 DSH 等价机制）\n';
    yml += '          - id: ask-user\n';
    yml += "            name: '@deepseek-ai/dsh-tool-ask-user'\n";
    yml += '          # 派活：每个执行角色一个具名 subagent 工具（源系统 dispatch_agent(role) 的 DSH 形态）\n';
    if (pausedEdges.length) {
      yml += '          #\n';
      yml += '          # ── 下面的派活工具暂时停用（TEMPORARY，不是删除、不是废弃）──────────────────\n';
      yml += '          # 这些行**完整保留**（provider / toolName / persona 一字未改），只加 `disabled: true`，\n';
      yml += '          # 因此不会进入 DIRECTOR 当前可调用的工具集合；Loader 对 disabled 行不实例化、也不校验 config，\n';
      yml += '          # 所以它们既不会报错，也不会把整个 preset 打成 broken。\n';
      yml += '          # 目标 Agent 本身（ARTIST / VOICE_ACTOR / MUSIC_COMPOSER / EDITOR）及其 persona/skill 完全不受影响。\n';
      yml += '          #\n';
      yml += '          # 恢复方式：把 agents/definitions.js 里对应边的 `dispatchEnabled` 改回 true（或删掉该键），\n';
      yml += '          # 重跑 `node scripts/build-bundle.mjs`，然后删掉本段（含下面的 disabled: true 行）。\n';
      for (const e of pausedEdges) yml += `          # 暂停中：${e.tool} → ${e.to}\n`;
    }
    for (const e of ZHIRAI_TOPOLOGY.dispatchEdges) {
      const target = agents.find((x) => x.role === e.to);
      yml += `          - id: ${e.tool}\n`;
      yml += "            name: '@deepseek-ai/dsh-tool-subagent'\n";
      if (e.dispatchEnabled === false) yml += '            # 暂时停用：见上方说明；恢复时删除本行即可\n            disabled: true\n';
      yml += '            config:\n';
      yml += '              provider: spawn\n';
      yml += `              toolName: ${e.tool}\n`;
      yml += '              # persona 在该 schema 里是 string（不是 {prefix}）：源系统 prompt 原文整段作字符串传入。\n';
      yml += '              persona: ' + blockScalar(target.prompt, 16) + '\n';
    }
  }
  yml += '\n';
}

// ── 顶层：**不生成任何全局覆盖** ──
// 曾经这里有一条 `- id: system-prompt` 的 id 定向覆盖，把整个 Harness（含默认会话）的 persona 换成
// Director prompt。那会污染所有非 ZHIRAI 会话，已删除。
// 现在 6 个 Agent 的身份**只**由各自的 `@deepseek-ai/dsh-agent-preset` → `@deepseek-ai/dsh-persona` 提供：
// 会话选中某个 preset 时，preset 作用域里的 persona 会遮蔽部署 persona（正是本插件需要的可见性范围）。

fs.writeFileSync(path.join(root, 'cordis.patch.yml'), yml, 'utf8');
const lines = yml.split('\n').length;
console.log(`✓ cordis.patch.yml（${lines} 行，${agents.length} 个 preset）`);
console.log('\n生成完成。');
