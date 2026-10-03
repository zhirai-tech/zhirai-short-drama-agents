/**
 * 插件包静态验证 —— 使用 **DSH 安装自带的 js-yaml**（不是我自己写的解析器），
 * 并逐项对照 DSH 真实 schema：
 *   - @deepseek-ai/dsh-agent-preset 的 Config：id(required) / name / description / order / plugins(required)
 *   - @deepseek-ai/dsh-persona 的 Config：prefix(required) / suffix / complete / includeRuntimeContext
 *   - @deepseek-ai/dsh-skill-filesystem 的 Config：customSkillDirs / includeDefaultRoots / ...
 *   - @deepseek-ai/dsh-tool-subagent 的 Config：provider(required) / toolName / persona / toolFilter / ...
 *   - bundle 清单：package.json 的 dsh.bundle.patch 必须指向存在的文件
 *
 * 用法：node scripts/validate-bundle.mjs <dsh node_modules 目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dshModules = process.argv[2];
if (!dshModules) { console.error('用法: node scripts/validate-bundle.mjs <dsh node_modules 目录>'); process.exit(2); }

const yaml = await import(pathToFileURL(path.join(dshModules, 'js-yaml', 'index.js')).href);
const load = yaml.load || yaml.default?.load;
const DEFAULT_SCHEMA = yaml.DEFAULT_SCHEMA || yaml.default?.DEFAULT_SCHEMA;
if (typeof load !== 'function') { console.error('❌ 无法加载 js-yaml'); process.exit(2); }

/**
 * `!!js` 是 DSH Cordis Loader 的**自定义 tag**（`!!js <expression>` 保留到自身激活时求值，
 * 见 @deepseek-ai/dsh-agent-preset 的 `[EntryGroup.key] = true` 与 Loader 方言）。
 * 校验时把它注册成一个只读标量类型 —— 这样既能证明 YAML 结构合法，又**不会**去执行表达式。
 */
const jsTagType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: () => true,
  construct: (data) => ({ __jsExpression: String(data) }),
});
const SCHEMA = DEFAULT_SCHEMA.extend([jsTagType]);
const loadWithJs = (text) => load(text, { schema: SCHEMA });

const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : fail.push(msg));

// ── 1. manifest ──
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(pkg.name === '@local/zhirai-short-drama-agents', `manifest name = ${pkg.name}`);
check(pkg.type === 'module', 'manifest type = module');
const patchRel = pkg.dsh?.bundle?.patch;
check(typeof patchRel === 'string' && !!patchRel, `manifest dsh.bundle.patch = ${patchRel}`);
const patchPath = path.join(root, String(patchRel || ''));
check(fs.existsSync(patchPath), `patch 文件存在：${patchRel}`);
check(fs.existsSync(path.join(root, String(pkg.icon || ''))), `icon 存在：${pkg.icon}`);
for (const f of ['locale/zh.json', 'locale/en.json']) {
  check(fs.existsSync(path.join(root, f)), `${f} 存在`);
  const j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  check(typeof j.title === 'string' && j.title.length > 0, `${f} 含 title`);
  check(typeof j.description === 'string' && j.description.length > 0, `${f} 含 description`);
}

// ── 2. patch YAML 解析（DSH 自带 js-yaml） ──
const doc = loadWithJs(fs.readFileSync(patchPath, 'utf8'));
check(Array.isArray(doc), 'patch 顶层是数组（Loader patch 方言）');
const insertEntry = doc.find((e) => e && Array.isArray(e.insert));
check(!!insertEntry, 'patch 含 insert 列表');
const rows = insertEntry ? insertEntry.insert : [];
check(rows.length >= 7, `insert 行数 = ${rows.length}（1 个 Host 行 + 6 个 preset 应为 7）`);

// ── 3. 逐行校验（对照 DSH 真实 schema） ──
const AGENT_PRESET = '@deepseek-ai/dsh-agent-preset';
const PERSONA = '@deepseek-ai/dsh-persona';
const SKILL_FS = '@deepseek-ai/dsh-skill-filesystem';
const TOOL_SUBAGENT = '@deepseek-ai/dsh-tool-subagent';
const TOOL_ASK_USER = '@deepseek-ai/dsh-tool-ask-user';

const presetRows = rows.filter((r) => r.name === AGENT_PRESET);
check(presetRows.length === 6, `agent-preset 声明数 = ${presetRows.length}（期望 6）`);

const presets = [];
for (const r of presetRows) {
  const c = r.config || {};
  const tag = r.id || '(no id)';
  check(r.id === `preset-${c.id}`, `${tag}: Loader 行 id 约定 preset-<id>`);
  const idOk = typeof c.id === 'string' && /^[a-z0-9-]+$/.test(c.id);
  check(idOk, `${tag}: config.id 合法（小写字母/数字/连字符）= ${c.id}`);
  check(typeof c.name === 'string' && c.name.length > 0, `${tag}: config.name 非空`);
  check(typeof c.description === 'string' && c.description.length > 0, `${tag}: config.description 非空`);
  check(typeof c.order === 'number', `${tag}: config.order 是数字 = ${c.order}`);
  check(Array.isArray(c.plugins) && c.plugins.length > 0, `${tag}: config.plugins 是非空数组（${(c.plugins || []).length} 项）`);

  for (const p of c.plugins || []) {
    const pc = p.config || {};
    if (p.name === PERSONA) {
      check(typeof pc.prefix === 'string' && pc.prefix.trim().length > 0, `${tag}/persona: prefix 非空（${String(pc.prefix || '').length} 字）`);
      check(typeof pc.complete === 'boolean', `${tag}/persona: complete 是布尔`);
    } else if (p.name === SKILL_FS) {
      check(Array.isArray(pc.customSkillDirs), `${tag}/skill-filesystem: customSkillDirs 是数组`);
      for (const d of pc.customSkillDirs || []) {
        // `!!js` 表达式被解析成 {__jsExpression}；两种形态都接受，但必须指向本包 agents/
        const text = typeof d === 'string' ? d : String(d?.__jsExpression || '');
        check(text.includes('/agents/'), `${tag}/skill-filesystem: 技能目录指向本包 agents/（${text.slice(0, 60)}）`);
      }
    } else if (p.name === TOOL_SUBAGENT) {
      check(typeof pc.provider === 'string' && pc.provider.length > 0, `${tag}/tool-subagent: provider 非空 = ${pc.provider}`);
      check(typeof pc.toolName === 'string' && /^[a-z_][a-z0-9_]*$/.test(pc.toolName || ''), `${tag}/tool-subagent: toolName 合法 = ${pc.toolName}`);
      check(!!pc.persona && typeof pc.persona.prefix === 'string' && pc.persona.prefix.length > 0, `${tag}/tool-subagent: persona.prefix 非空（${String(pc.persona?.prefix || '').length} 字）`);
    }
  }
  presets.push(c);
}

// ── 4. 关键纪律：不得声明任何模型/供应商（任务书 §九） ──
// 只检查 `provider:` / `model:` / 模型名字面量；`@deepseek-ai/...` 是 DSH 包名，不算模型绑定。
const rawPatch = fs.readFileSync(patchPath, 'utf8');
const modelLeak =
  /(?:^|\n)\s*model:\s*\S+/.exec(rawPatch) ||
  /(?:^|\n)\s*provider:\s*(?!spawn\b)\S+/.exec(rawPatch) ||
  /\b(?:doubao|gpt-4|gpt-3|claude-3|ltx|seedance|vidu)\b/i.exec(rawPatch);
check(!modelLeak, `patch 未硬编码任何模型/供应商${modelLeak ? `（发现：${JSON.stringify(modelLeak[0].trim())}）` : ''}`);

// Director 必须挂 ask_user + 5 个派活工具；执行角色不得挂派活工具
const dir = presets.find((p) => p.id === 'zhirai-director');
check(!!dir, '存在 zhirai-director preset');
if (dir) {
  const names = dir.plugins.map((p) => p.name);
  check(names.includes(TOOL_ASK_USER), 'director 挂了 ask-user（结构化提问）');
  const subs = dir.plugins.filter((p) => p.name === TOOL_SUBAGENT);
  check(subs.length === 5, `director 的派活工具数 = ${subs.length}（期望 5，对应 5 个执行角色）`);
  check(new Set(subs.map((s) => s.config.toolName)).size === 5, 'director 的 5 个派活工具名互不重复');
}
for (const p of presets.filter((x) => x.id !== 'zhirai-director')) {
  const hasSub = p.plugins.some((q) => q.name === TOOL_SUBAGENT);
  check(!hasSub, `${p.id}: 执行角色不挂派活工具（与源系统 TOOL_CALLING_ROLES 一致）`);
}

// ── 5. 生成物与源系统 prompt 的一致性（逐字比对） ──
const prompts = JSON.parse(fs.readFileSync(path.join(root, 'agents', 'prompts.json'), 'utf8'));
check(prompts.agents.length === 6, `prompts.json 含 6 个 Agent`);
for (const a of prompts.agents) {
  const row = presetRows.find((r) => r.config?.id === a.presetId);
  const persona = row?.config?.plugins?.find((p) => p.name === PERSONA);
  const inPatch = String(persona?.config?.prefix || '');
  check(inPatch.length > 0, `${a.presetId}: persona.prefix 已写入 patch（${inPatch.length} 字）`);
  // 源 prompt 只做 {language} 展开，其余必须逐字一致
  const expanded = String(a.sourcePrompt).split('{language}').join('Reply in the language the user writes in.');
  check(inPatch === expanded, `${a.presetId}: prompt 与源系统原文逐字一致（展开 {language} 后）`);
  const skill = path.join(root, 'agents', a.presetId, 'SKILL.md');
  check(fs.existsSync(skill), `${a.presetId}: SKILL.md 存在`);
}

// ── 6. Host 插件导出形态（host-plugin.md：apply + 可选 inject/Config，不混用 default class） ──
const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
check(/export function apply\(/.test(idx), 'index.js 导出 apply(ctx, config)');
// Config 是**可选**导出；但一旦导出就必须是 schemastery schema（否则 Cordis resolveConfig 抛
// "Cannot read properties of undefined (reading 'validate')" → 整行导入失败、Agent 退回宿主 persona）。
if (/export const Config/.test(idx)) {
  check(/schemastery|Schema\s*\.|z\.object/.test(idx), 'Config 为 schemastery schema（非普通对象）');
} else {
  ok.push('未导出 Config（可选）；插件无配置项，避开无效 Config 导致导入失败');
}
check(!/export default class/.test(idx), 'index.js 未把 service class 作为 default 混用');

// ── 输出 ──
console.log(`通过 ${ok.length} 项：`);
for (const o of ok) console.log('  ✓ ' + o);
if (fail.length) {
  console.log(`\n失败 ${fail.length} 项：`);
  for (const f of fail) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\n✅ 插件包静态验证全部通过（YAML 用 DSH 自带 js-yaml 解析，schema 对照 DSH 真实 Config）');
