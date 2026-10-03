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
import { ZHIRAI_AGENTS, ZHIRAI_TOPOLOGY, LANGUAGE_DIRECTIVE } from '../agents/definitions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

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

// ── 1. prompts.json（完整原文，供审计与在 Harness 里查看） ──
fs.writeFileSync(
  path.join(root, 'agents', 'prompts.json'),
  JSON.stringify(
    {
      generatedFrom: {
        source: 'apps/api/src/modules/agent/default-agents.ts + dev.db Agent(is_system=1)',
        agents: agents.map((a) => ({ role: a.role, sourceAgentId: a.sourceAgentId, promptLength: a.sourcePrompt.length })),
      },
      note: 'prompt 为源系统运行版本原文；仅把 {language} 占位符展开为语言指令（见 ADAPTERS.languagePlaceholder）。',
      agents: agents.map((a) => ({
        role: a.role,
        presetId: a.presetId,
        name: a.name,
        description: a.description,
        sourceTools: a.sourceTools,
        sourcePrompt: a.sourcePrompt,
        prompt: a.prompt,
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
/** YAML 里 persona.prefix 用块标量，避免提示词里的引号/冒号破坏 YAML */
const blockScalar = (text, indent) => {
  const pad = ' '.repeat(indent);
  return '|-\n' + text.split('\n').map((l) => (l.length ? pad + l : '')).join('\n');
};

let yml = '';
yml += '# 本文件由 scripts/build-bundle.cjs 从 definitions.js + _extracted-agents.json 生成 —— 请勿手改。\n';
yml += '# 内容：1) Host 插件行（插件可见/可管理）  2) 每个 ZHIRAI Agent 一个 @deepseek-ai/dsh-agent-preset 声明\n';
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
yml += '    # ── Agent preset 注册表：声明本插件的默认 preset（Web/agent-preset 型 surface 用） ──\n';
yml += '    # 官方口径（@deepseek-ai/dsh-agent-preset-registry README）：`default` = 未显式请求时使用的 preset id。\n';
yml += '    - id: agent-preset-registry\n';
yml += "      name: '@deepseek-ai/dsh-agent-preset-registry'\n";
yml += '      config:\n';
yml += `        default: ${ZHIRAI_AGENTS[0].presetId}\n`;
yml += '\n';
yml += '    # ── Agent 声明：源系统 6 个系统 Agent，一人一个 preset ──\n';
for (const a of agents) {
  yml += `    # ${a.name}（${a.role}）· 源 Agent.id=${a.sourceAgentId} · 源 prompt ${a.sourcePrompt.length} 字\n`;
  yml += `    - id: preset-${a.presetId}\n`;
  yml += "      name: '@deepseek-ai/dsh-agent-preset'\n";
  yml += '      config:\n';
  yml += `        id: ${a.presetId}\n`;
  yml += `        name: ${JSON.stringify(`${a.name}（${a.role}）`)}\n`;
  yml += `        description: ${JSON.stringify(a.description)}\n`;
  yml += `        order: ${a.order}\n`;
  yml += '        plugins:\n';
  yml += '          # 身份：源系统该 Agent 的 system prompt 原文（{language} 已展开）\n';
  yml += '          - id: persona\n';
  yml += "            name: '@deepseek-ai/dsh-persona'\n";
  yml += '            config:\n';
  yml += '              prefix: ' + blockScalar(a.prompt, 16) + '\n';
  yml += '              complete: true\n';
  yml += '              includeRuntimeContext: false\n';
  yml += '          # 记忆范围 / 生产阶段口径：源系统该角色的 stage 职责\n';
  yml += '          - id: role-skill\n';
  yml += "            name: '@deepseek-ai/dsh-skill-filesystem'\n";
  yml += '            config:\n';
  yml += '              includeDefaultRoots: true\n';
  yml += `              # !!js 由 DSH Cordis Loader 在行激活时求值；工具调用时 cwd = 本插件目录（node_modules/<pkg>）\n`;
  yml += `              customSkillDirs:\n`;
  yml += `                - !!js new URL('./agents/${a.presetId}', import.meta.url).pathname\n`;
  if (a.role === 'DIRECTOR') {
    yml += '          # 结构化提问：让用户做选择（源系统 ask_user_choice 的 DSH 等价机制）\n';
    yml += '          - id: ask-user\n';
    yml += "            name: '@deepseek-ai/dsh-tool-ask-user'\n";
    yml += '          # 派活：每个执行角色一个具名 subagent 工具（源系统 dispatch_agent(role) 的 DSH 形态）\n';
    for (const e of ZHIRAI_TOPOLOGY.dispatchEdges) {
      const target = agents.find((x) => x.role === e.to);
      yml += `          - id: ${e.tool}\n`;
      yml += "            name: '@deepseek-ai/dsh-tool-subagent'\n";
      yml += '            config:\n';
      yml += '              provider: spawn\n';
      yml += `              toolName: ${e.tool}\n`;
      yml += '              persona:\n';
      yml += '                prefix: ' + blockScalar(target.prompt, 18) + '\n';
    }
  }
  yml += '\n';
}

// ── 顶层：id 定向 config 覆盖 ──
// `dsh-base` 未挂载 preset 系统（实测 dump 内无 agent-preset-registry 行），所以只有 system-prompt 的
// surface（headless）不会走 preset。用官方支持的 id 定向覆盖把同一个 Agent 的 persona 装进去，
// 内容与 preset 的 persona **完全相同**（源系统 Director prompt 原文）—— 不是第二套 Agent。
yml += '# ── 顶层 id 定向 config 覆盖：让只挂 system-prompt 的 surface（如 headless）也使用本插件的 Director Agent ──\n';
yml += '# 覆盖是官方支持的 patch 形态；persona 内容与下面 preset 里的 persona 逐字相同（同一份源系统 prompt）。\n';
yml += '- id: system-prompt\n';
yml += "  name: '@deepseek-ai/dsh-system-prompt'\n";
yml += '  config:\n';
yml += '    personaSuffix: Your working directory is {{cwd}}.\n';
yml += '    personaPrefix: ' + blockScalar(agents[0].prompt, 6) + '\n';

fs.writeFileSync(path.join(root, 'cordis.patch.yml'), yml, 'utf8');
const lines = yml.split('\n').length;
console.log(`✓ cordis.patch.yml（${lines} 行，${agents.length} 个 preset）`);
console.log('\n生成完成。');
