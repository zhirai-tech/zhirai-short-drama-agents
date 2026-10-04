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
import { ZHIRAI_AGENTS, ZHIRAI_TOPOLOGY, ZHIRAI_DIRECTOR_TEST_MODE } from '../agents/definitions.js';

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
        // `!!js` 表达式被解析成 {__jsExpression}；两种形态都接受，但必须指向本包 agents/<presetId>
        const text = typeof d === 'string' ? d : String(d?.__jsExpression || '');
        check(text.includes("'agents'") && text.includes(c.id), `${tag}/skill-filesystem: 技能目录解析到本包 agents/${c.id}`);
        // Loader 的 !!js 求值器是 `new Function(...)`，没有模块作用域 —— import.meta 会直接抛
        // "Cannot use 'import.meta' outside a module"，把整个 preset 打成 broken。
        check(!text.includes('import.meta'), `${tag}/skill-filesystem: 表达式未使用 import.meta（Loader 求值无模块作用域）`);
      }
    } else if (p.name === TOOL_SUBAGENT) {
      check(typeof pc.provider === 'string' && pc.provider.length > 0, `${tag}/tool-subagent: provider 非空 = ${pc.provider}`);
      check(typeof pc.toolName === 'string' && /^[a-z_][a-z0-9_]*$/.test(pc.toolName || ''), `${tag}/tool-subagent: toolName 合法 = ${pc.toolName}`);
      // 当前 @deepseek-ai/dsh-tool-subagent 的 Config 里 `persona: z.string()`；
      // 传对象（旧写法 {prefix: …}）会得到
      // "invalid config: $.persona expected string but got [object Object] (at persona)"
      // 并让整个 preset 变成 agent-preset/invalid。
      check(typeof pc.persona === 'string' && pc.persona.trim().length > 0, `${tag}/tool-subagent: persona 是字符串（${typeof pc.persona}，${String(pc.persona || '').length} 字）`);
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

// `!!js` 表达式里不得出现 import.meta（Loader 用 new Function 求值，没有模块作用域）。
const badImportMeta = rawPatch
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('#'))
  .find((line) => line.includes('import.meta'));
check(!badImportMeta, `patch 的可执行行未使用 import.meta${badImportMeta ? `（发现：${badImportMeta.trim().slice(0, 80)}）` : ''}`);

// Director 必须挂 ask_user + 5 个派活工具声明；执行角色不得挂派活工具
const dir = presets.find((p) => p.id === 'zhirai-director');
check(!!dir, '存在 zhirai-director preset');
if (dir) {
  const names = dir.plugins.map((p) => p.name);
  check(names.includes(TOOL_ASK_USER), 'director 挂了 ask-user（结构化提问）');
  const subs = dir.plugins.filter((p) => p.name === TOOL_SUBAGENT);
  check(subs.length === 5, `director 的派活工具声明数 = ${subs.length}（期望 5，对应 5 个执行角色）`);
  check(new Set(subs.map((s) => s.config.toolName)).size === 5, 'director 的 5 个派活工具名互不重复');
}
for (const p of presets.filter((x) => x.id !== 'zhirai-director')) {
  const hasSub = p.plugins.some((q) => q.name === TOOL_SUBAGENT);
  check(!hasSub, `${p.id}: 执行角色不挂派活工具（与源系统 TOOL_CALLING_ROLES 一致）`);
}

// ── 4b. 临时暂停开关：dispatchEnabled === false 的边必须带 disabled: true，启用的边必须不带 ──
// 语义：行**完整保留**（provider/toolName/persona 原样），只额外 `disabled: true`，
// 于是不进入 DIRECTOR 可调用的工具集合；Loader 对 disabled 行不实例化、不校验 config，
// 所以暂停既不会报错、也不会把 preset 打成 broken。
const edgeRows = new Map();
{
  const dirRow = presetRows.find((r) => r.config?.id === 'zhirai-director');
  const byId = new Map();
  for (const l of rawPatch.split(/\r?\n/)) {
    const m = /^\s+- id: ([a-z]_dispatch)\s*$/.exec(l);
    if (m) byId.set(m[1], null);
  }
  // 用 YAML 解析后的行对象做权威判定（注释里的文字不参与）
  for (const p of dirRow?.config?.plugins ?? []) {
    if (p.name === TOOL_SUBAGENT && p.id) edgeRows.set(p.id, p);
  }
}
for (const e of ZHIRAI_TOPOLOGY.dispatchEdges) {
  const row = edgeRows.get(e.tool);
  const shouldPause = e.dispatchEnabled === false;
  check(!!row, `派活行存在：${e.tool} → ${e.to}`);
  if (!row) continue;
  check(
    shouldPause ? row.disabled === true : row.disabled === undefined,
    `派活行 ${e.tool} → ${e.to}：${shouldPause ? '已暂停（disabled: true）' : '启用（无 disabled）'}，实际 disabled=${JSON.stringify(row.disabled)}`,
  );
  check(row.config?.provider === 'spawn', `${e.tool}: 暂停/启用都不丢 provider`);
  check(row.config?.toolName === e.tool, `${e.tool}: 暂停/启用都不丢 toolName`);
  check(typeof row.config?.persona === 'string' && row.config.persona.length > 0, `${e.tool}: 暂停/启用都不丢 persona（恢复即可用）`);
}
const pausedEdges = ZHIRAI_TOPOLOGY.dispatchEdges.filter((e) => e.dispatchEnabled === false);
const activeEdges = ZHIRAI_TOPOLOGY.dispatchEdges.filter((e) => e.dispatchEnabled !== false);
check(activeEdges.length === 1 && activeEdges[0].to === 'WRITER', `当前只放行 WRITER（实际放行：${activeEdges.map((e) => e.to).join(', ') || '无'}）`);
check(pausedEdges.length === 4, `当前暂停 4 条派活边（实际 ${pausedEdges.length}）`);

// ── 4c. 被暂停的四个 Agent 必须**完整保留**（本阶段只暂停调用，不删除任何 Agent）──
const PAUSED_ROLES = ['ARTIST', 'VOICE_ACTOR', 'MUSIC_COMPOSER', 'EDITOR'];
for (const role of PAUSED_ROLES) {
  const def = ZHIRAI_AGENTS.find((a) => a.role === role);
  check(!!def, `${role}: 定义仍在 definitions.js（未删除）`);
  if (!def) continue;
  const row = presetRows.find((r) => r.config?.id === def.presetId);
  check(!!row, `${role}: preset 行仍在 patch（${def.presetId}）`);
  check(!!row && typeof row.config?.name === 'string' && row.config.name.length > 0, `${role}: preset 仍带显示名`);
  const persona = row?.config?.plugins?.find((p) => p.name === PERSONA);
  check(!!persona && typeof persona.config?.prefix === 'string' && persona.config.prefix.trim().length > 0, `${role}: persona/prompt 仍在 patch`);
  check(fs.existsSync(path.join(root, 'agents', def.presetId, 'SKILL.md')), `${role}: SKILL.md 仍在 agents/${def.presetId}/`);
  check((row?.config?.plugins ?? []).length > 0, `${role}: preset 的 plugins 列表非空（工具配置保留）`);
  check(def.userFacing === true, `${role}: 仍标记为可被用户直接选用（未禁用）`);
}

// ── 4d. 临时测试模式约束：只追加在 DIRECTOR 的 persona 尾部，且可整段删除 ──
{
  const dirRow = presetRows.find((r) => r.config?.id === 'zhirai-director');
  const dirPersona = dirRow?.config?.plugins?.find((p) => p.name === PERSONA)?.config?.prefix || '';
  check(dirPersona.endsWith(ZHIRAI_DIRECTOR_TEST_MODE), '临时测试模式约束追加在 DIRECTOR persona 的末尾（便于整段删除）');
  check(dirPersona.includes('【临时测试模式】'), 'DIRECTOR persona 含临时测试模式标记');
  const others = presets.filter((p) => p.id !== 'zhirai-director');
  const leaked = others.filter((p) =>
    (p.plugins.find((q) => q.name === PERSONA)?.config?.prefix || '').includes('【临时测试模式】'),
  );
  check(leaked.length === 0, `临时测试模式约束未泄漏到其他 Agent${leaked.length ? `（发现：${leaked.map((p) => p.id).join(', ')}）` : ''}`);
}

// ── 4e. 本阶段纪律：不得覆盖默认 Main Agent（官方 dsh-web-app 的 default: standard）──
check(!/^\s+- id: agent-preset-registry\s*$/m.test(rawPatch), 'patch 未声明 agent-preset-registry（不覆盖默认 Main Agent）');
check(!/^\s+default:\s/m.test(rawPatch), 'patch 未出现任何 default: 键（含改选 Main Agent 的可能）');

// ── 4f. 真实落盘能力：DIRECTOR 必须挂上 Harness **原生**文件工具 ──
// 根因：这些 agent-plane 行在部署里被 dsh-web-app 的 base 层 disabled，只有 preset 自己挂载才可见。
// 若这里缺失，Agent 能生成大量正文却无法在磁盘上创建任何文件（只会说「等待写盘」）。
{
  const dirRow = presetRows.find((r) => r.config?.id === 'zhirai-director');
  const rows = dirRow?.config?.plugins ?? [];
  const byId = new Map(rows.map((p) => [p.id, p]));

  check(!!byId.get('tool-fs') && byId.get('tool-fs').name === '@deepseek-ai/dsh-tool-fs', 'DIRECTOR 挂了 @deepseek-ai/dsh-tool-fs（read/write/edit 真落盘）');
  check(byId.get('tool-fs')?.disabled !== true, 'DIRECTOR 的 tool-fs 未被禁用');
  check(!!byId.get('tool-fs-search') && byId.get('tool-fs-search').name === '@deepseek-ai/dsh-tool-fs-search', 'DIRECTOR 挂了 @deepseek-ai/dsh-tool-fs-search（glob/grep）');
  check(byId.get('tool-fs-search')?.config?.sampleOverCapGlobResults === false, 'tool-fs-search 带必填的 sampleOverCapGlobResults');
  check(!!byId.get('tool-skill') && byId.get('tool-skill').name === '@deepseek-ai/dsh-tool-skill', 'DIRECTOR 挂了 tool-skill（skill 工具）');

  // ── 能力发现适配器：必须挂载，且必须是本插件的薄适配器（不是自造 registry）──
  const cap = byId.get('capability-discovery');
  check(!!cap, 'DIRECTOR 挂了 capability-discovery（运行时能力发现适配器）');
  check(!!cap && cap.name === '@local/zhirai-short-drama-agents/agents/capability-discovery.js', `capability-discovery 指向本插件适配器模块（实际：${cap?.name}）`);
  check(!!cap && cap.disabled !== true, 'capability-discovery 未被禁用');
  const adapterPath = path.join(root, 'agents', 'capability-discovery.js');
  check(fs.existsSync(adapterPath), 'agents/capability-discovery.js 存在');
  const adapterSrc = fs.existsSync(adapterPath) ? fs.readFileSync(adapterPath, 'utf8') : '';
  // 适配器只读 Harness 注册表；不得自己维护工具名单，也不得自造 registry。
  check(/ctx\.get\('tools'\)|ctx\.get\("tools"\)/.test(adapterSrc), '适配器通过 Harness ctx.tools 读取工具（复用官方 registry）');
  check(/schemas\(\s*scope\s*\)/.test(adapterSrc), '适配器用 tools.schemas(scope) —— 传查看者 scope（不传只会拿到 global 层）');
  check(/skills[\s\S]{0,80}\.list\(/.test(adapterSrc), '适配器通过 ctx.skills.list 读取技能');
  check(/sandboxPolicy/.test(adapterSrc), '适配器读取 Harness 的 sandboxPolicy（不复制权限策略）');
  check(!/registerProvider|tools\.register\(\s*\{[\s\S]{0,200}?name:\s*'(?!capabilities)/.test(adapterSrc), '适配器除只读 capabilities 入口外不注册其它工具');
  // 不得在适配器里硬编码能力名单（工具名数组）
  const hardcodedToolList = /\b(?:read|write|edit|glob|grep|bash|pwsh|web_search|web_fetch)\b\s*,\s*\n?\s*'(?:read|write|edit|glob|grep)/.test(adapterSrc);
  check(!hardcodedToolList, '适配器未硬编码工具名单');

  // preset 的 mount 行必须来自单一常量（避免多处维护能力清单）
  const mountRows = ['tool-fs', 'tool-fs-search', 'tool-skill'];
  for (const id of mountRows) check(!!byId.get(id), `mount 行存在：${id}`);
  check(!/ZHIRAI_DIRECTOR_NATIVE_TOOLS|ZHIRAI_ALLOWED_TOOLS|ZHIRAI_SUPPORTED_TOOLS|ZHIRAI_TOOLS\b/.test(fs.readFileSync(path.join(root, 'scripts', 'build-bundle.mjs'), 'utf8')), '构建脚本不再引用旧的多套工具清单常量');

  // skill provider 唯一性：同一 scope 内 `filesystem` skill provider 只能注册一次。
  // 曾经因为额外加了一条 skill-filesystem 行，运行时报
  // `a skill provider named "filesystem" is already registered in this scope` 并把 preset 打成 broken。
  const skillFsRows = rows.filter((p) => p.name === SKILL_FS);
  check(skillFsRows.length === 1, `DIRECTOR 只有一条 @deepseek-ai/dsh-skill-filesystem（实际 ${skillFsRows.length}，重复注册会让 preset broken）`);
  check(skillFsRows[0]?.id === 'role-skill', 'DIRECTOR 的技能目录行仍是 role-skill（未另起一条重复行）');
  check(skillFsRows[0]?.config?.includeDefaultRoots === false, 'DIRECTOR 的技能扫描已收窄为 includeDefaultRoots: false（只扫本插件技能）');
  check(Array.isArray(skillFsRows[0]?.config?.customSkillDirs) && skillFsRows[0].config.customSkillDirs.length > 0, 'DIRECTOR 的 role-skill 仍带 customSkillDirs');

  // 复用而非自造：不允许挂 fs-local（会与宿主的 fs-sandbox 二次注册 ctx.fs 而加载失败）
  check(!byId.has('fs-local') && !rows.some((p) => p.name === '@deepseek-ai/dsh-fs-local'), 'DIRECTOR 未重复挂载 dsh-fs-local（避免 ctx.fs 二次注册）');
  // 未新增任何非官方**业务工具**行：允许官方行 + 本插件自己的能力发现适配器
  const ownAdapter = '@local/zhirai-short-drama-agents/agents/capability-discovery.js';
  const nonOfficial = rows.filter(
    (p) => typeof p.name === 'string' && !p.name.startsWith('@deepseek-ai/') && p.name !== 'cordis:group' && p.name !== ownAdapter,
  );
  check(nonOfficial.length === 0, `DIRECTOR 未新增自定义业务工具（非官方非适配器行：${nonOfficial.map((p) => p.name).join(', ') || '无'}）`);

  // 固定落盘结构与 SSOT 纪律必须写在 persona 里（系统固定行为，不靠用户提示词）
  const dirPersona = rows.find((p) => p.name === PERSONA)?.config?.prefix || '';
  for (const dir of ['01_项目', '02_人物', '03_剧本', '04_分集', '05_分镜', '06_提示词', '07_制作资源', '08_执行']) {
    check(dirPersona.includes(dir), `DIRECTOR persona 含固定目录 ${dir}`);
  }
  check(dirPersona.includes('单一事实源'), 'DIRECTOR persona 含 Single Source of Truth 纪律');
  check(dirPersona.includes('必须真实写盘'), 'DIRECTOR persona 含真实写盘闭环要求');
  check(/write/.test(dirPersona) && /read/.test(dirPersona), 'DIRECTOR persona 要求 write 后 read 回读验证');

  // 提问通道：源 prompt 写的是 ask_user_choice（源系统工具，Harness 里不存在），
  // 必须显式映射到 Harness 原生 ask_user_question，否则模型会自己发明文本协议，
  // 把 `<function_calls><invoke …>` 当正文输出（真实事故根因）。
  check(dirPersona.includes('ask_user_question'), 'DIRECTOR persona 明确要求调用 Harness 原生 ask_user_question');
  check(dirPersona.includes('multi_select'), 'DIRECTOR persona 给出 selectionMode → multi_select 的参数映射');
  check(dirPersona.includes('`title` → **`question`**'), 'DIRECTOR persona 给出 title → question 的参数映射');
  check(/function_calls/.test(dirPersona) && /绝对不要/.test(dirPersona), 'DIRECTOR persona 明确禁止输出 tool-call 原码文本');
  check(dirPersona.includes('[CHOICE]'), 'DIRECTOR persona 说明 [CHOICE] 标记在 Harness 中不被解析');
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
  if (a.presetId === 'zhirai-director') {
    // DIRECTOR 的 persona = [cwd 声明] + 源 prompt + 临时测试模式约束（都可整段删除）。
    // 注意 prefix 里出现 `{{cwd}}` 是**有意**的：persona 用 complete:true 会丢掉部署放在 suffix 里的
    // cwd 提示，所以在 prefix 自带一份。插值发生在 assemble 之后的渲染阶段：
    //   - `systemPrompt.assemble()` 返回的 section.text 仍是字面 `{{cwd}}`（未插值）；
    //   - 真正发给模型的 `system/message` 里已是渲染后的绝对路径。
    // 判断必须看 `system/message`，不能只看 assemble()。
    check(inPatch.startsWith('Your working directory is {{cwd}}.'), `${a.presetId}: prefix 以 {{cwd}} 声明开头（complete 模式丢 suffix，需自带 cwd）`);
    check(inPatch.endsWith(ZHIRAI_DIRECTOR_TEST_MODE), `${a.presetId}: 源 prompt 之后只追加了临时测试模式约束`);
    const body = inPatch.slice('Your working directory is {{cwd}}.\n\n'.length, inPatch.length - ZHIRAI_DIRECTOR_TEST_MODE.length);
    check(body === expanded, `${a.presetId}: 去掉包装段后与源系统原文逐字一致（展开 {language} 后）`);
  } else {
    // 其它角色没有 complete:true，cwd 由部署 suffix 提供，因此**不得**出现任何模板占位。
    check(!inPatch.includes('{{'), `${a.presetId}: persona 不含任何 {{...}} 模板占位`);
    check(inPatch === expanded, `${a.presetId}: prompt 与源系统原文逐字一致（展开 {language} 后）`);
  }
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
