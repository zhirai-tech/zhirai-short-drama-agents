/**
 * 结构同构验证 —— 把本插件的 preset 声明与 DSH **自带** preset 做结构对照。
 *
 * 为什么这是有效证据：DSH 自带 preset（standard/ptc/minimal/cordis）是被 Harness 真实加载运行的，
 * 若本插件的声明与它们在「顶层字段 + plugins 行结构」上同构，说明它符合真实加载格式，
 * 而不是我自己发明的格式。
 *
 * 用法：node scripts/compare-with-shipped.mjs <js-yaml 所在 node_modules> <asar 路径>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dshModules = process.argv[2];
const asarPath = process.argv[3];
if (!dshModules || !asarPath) { console.error('用法: node scripts/compare-with-shipped.mjs <js-yaml node_modules> <app.asar>'); process.exit(2); }

const yaml = await import(pathToFileURL(path.join(dshModules, 'js-yaml', 'index.js')).href);
const load = yaml.load || yaml.default?.load;
const DEFAULT_SCHEMA = yaml.DEFAULT_SCHEMA || yaml.default?.DEFAULT_SCHEMA;
const jsTagType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: () => true, construct: (d) => ({ __js: String(d) }) });
const SCHEMA = DEFAULT_SCHEMA.extend([jsTagType]);

/** 直接从 asar 读取（只读，不解包） */
function readFromAsar(innerPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const size = head.readUInt32LE(12);
    const hdr = Buffer.alloc(size);
    fs.readSync(fd, hdr, 0, size, 16);
    const json = JSON.parse(hdr.toString('utf8').replace(/\0+$/, ''));
    const parts = innerPath.split('/').filter(Boolean);
    let node = json;
    for (const p of parts) { node = node.files?.[p]; if (!node) return null; }
    if (!node.offset && node.offset !== 0) return null;
    const b = Buffer.alloc(node.size);
    fs.readSync(fd, b, 0, node.size, 16 + size + Number(node.offset));
    return b.toString('utf8');
  } finally { fs.closeSync(fd); }
}

const shape = (o) => {
  if (Array.isArray(o)) return `[${o.length}]`;
  if (o && typeof o === 'object') return `{${Object.keys(o).sort().join(',')}}`;
  return typeof o;
};

const shipped = {};
for (const id of ['minimal', 'standard', 'ptc', 'cordis']) {
  const text = readFromAsar(`/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`);
  if (!text) { console.log(`  (跳过 ${id}：asar 内未找到)`); continue; }
  const doc = load(text, { schema: SCHEMA });
  const row = doc.flatMap((e) => e.insert || []).find((r) => r.name === '@deepseek-ai/dsh-agent-preset');
  if (row) shipped[id] = row.config;
}
console.log(`DSH 自带 preset 读取成功：${Object.keys(shipped).join(', ')}`);

const mineDoc = load(fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8'), { schema: SCHEMA });
const mineRows = mineDoc.flatMap((e) => e.insert || []).filter((r) => r.name === '@deepseek-ai/dsh-agent-preset');
const mine = mineRows[0].config;

const fail = [];
const ok = [];

/**
 * 顶层字段的**权威依据**是 `@deepseek-ai/dsh-agent-preset` 自己的 Config schema：
 *   z.object({ id: required, name, description, order, plugins: required })
 * （从 asar 内的 lib/index.js 读取，不是推测）
 */
const presetIndex = readFromAsar('/dsh/node_modules/@deepseek-ai/dsh-agent-preset/lib/index.js') || '';
const schemaKeys = ['id', 'name', 'description', 'order', 'plugins'].filter((k) =>
  new RegExp(`\\b${k}\\s*:`).test(presetIndex.split('Config = z.object')[1] || ''),
);
ok.push(`preset 真实 schema 字段（读自 dsh-agent-preset/lib/index.js）：${schemaKeys.join(', ')}`);

// 1. 本插件 preset 的每个顶层字段都必须在真实 schema 里
for (const k of Object.keys(mine)) {
  (schemaKeys.includes(k) ? ok : fail).push(`顶层字段 \`${k}\` 属于 preset 真实 schema`);
}
for (const k of ['id', 'plugins']) {
  (schemaKeys.includes(k) ? ok : fail).push(`真实 schema 含必需字段 \`${k}\``);
}

// 2. plugins 行结构：每行必须是 {id?, name, config?}；name 必须是 DSH 真实包名或 cordis:group
const shippedRowKeys = new Set(
  Object.values(shipped).flatMap((c) => (c.plugins || []).flatMap((p) => Object.keys(p))),
);
let allRowsValid = true;
const names = new Set();
for (const p of mine.plugins || []) {
  const keysOk = Object.keys(p).every((k) => shippedRowKeys.has(k));
  if (!keysOk) { allRowsValid = false; fail.push(`plugin 行含自带 preset 未使用的键：${JSON.stringify(Object.keys(p))}`); }
  if (typeof p.name !== 'string' || !(p.name.startsWith('@deepseek-ai/') || p.name.startsWith('cordis:'))) {
    allRowsValid = false; fail.push(`plugin 行 name 不是 DSH 包名：${p.name}`);
  }
  names.add(p.name);
}
if (allRowsValid) ok.push(`全部 ${(mine.plugins || []).length} 个 plugin 行结构与自带 preset 同构（键集合 ${[...shippedRowKeys].sort().join(',')}）`);

// 3. 本插件用到的 DSH 包必须真实存在于 **DSH 安装内**（asar 目录清单，权威）
function asarPackageNames() {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const size = head.readUInt32LE(12);
    const hdr = Buffer.alloc(size);
    fs.readSync(fd, hdr, 0, size, 16);
    const json = JSON.parse(hdr.toString('utf8').replace(/\0+$/, ''));
    return new Set(Object.keys(json.files?.dsh?.files?.node_modules?.files?.['@deepseek-ai']?.files || {}));
  } finally { fs.closeSync(fd); }
}
const installed = asarPackageNames();
ok.push(`DSH 安装内 @deepseek-ai 包数 = ${installed.size}`);
for (const n of names) {
  if (!n.startsWith('@deepseek-ai/')) continue;
  const pkg = n.replace('@deepseek-ai/', '');
  (installed.has(pkg) ? ok : fail).push(`依赖包在 DSH 安装内真实存在：${n}`);
}

console.log(`\n通过 ${ok.length} 项：`);
for (const o of ok) console.log('  ✓ ' + o);
if (fail.length) {
  console.log(`\n失败 ${fail.length} 项：`);
  for (const f of fail) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\n✅ 本插件 preset 声明与 DSH 自带 preset 结构同构，且依赖包均真实存在');
