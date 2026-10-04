/**
 * ZHIRAI 受保护资源运行时（发布包专用）
 * --------------------------------------
 * 核心知识资产（6 个 Agent 的 persona/prompt、6 个角色技能正文）以 AES-256-GCM 密文
 * 存放于 assets/assets.enc.json，**不以明文出现在包内任何文件**。
 *
 * 本模块是唯一解密入口，由 cordis.patch.yml 的 !!js 表达式在行激活时调用：
 *   prefix: !!js process.getBuiltinModule('node:module')
 *                   .createRequire(baseUrl)('<pkg>/prompts.cjs').persona('<id>')
 *
 * 纪律：只做「解密 + 返回字符串 / 物化技能目录」；不联网、不校验授权、不要用户密码。
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY = Buffer.from('de5b2630d9cc0935ce6247fa1abdd488ad9dbdbb55cad5cc1aee73b5fd0d5329', 'hex');
const ASSETS = require('./assets/assets.enc.json');

const cache = new Map();
function decode(name) {
  if (cache.has(name)) return cache.get(name);
  const b64 = ASSETS.assets[name];
  if (!b64) throw new Error('[zhirai] protected asset missing: ' + name);
  const blob = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  const text = Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
  cache.set(name, text);
  return text;
}

/** 按资源名取受保护文本（cordis.patch.yml 的 !!js 表达式直接用这个入口） */
function text(name) { return decode(name); }

/** 某个 Agent 的 persona / system prompt 正文 */
function persona(id) { return decode(id + '.persona'); }

/** 某个角色的技能正文 */
function skill(id) { return decode(id + '.skill'); }

/** 受保护资源清单（审计用） */
function manifest() {
  try { return require('./assets/manifest.json').assets || []; } catch { return []; }
}

/**
 * 把全部角色技能物化到系统临时目录，返回技能根目录（其下每个角色一个子目录 + SKILL.md），
 * 供 dsh-skill-filesystem 扫描。仅首次调用写盘，进程内缓存。
 */
let skillRootCache = null;
function skillRoot() {
  if (skillRootCache) return skillRootCache;
  const root = path.join(os.tmpdir(), 'zhirai-skills-v1');
  for (const a of manifest()) {
    if (!/\.skill$/.test(a.name)) continue;
    const id = a.name.replace(/\.skill$/, '');
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skill(id), 'utf8');
  }
  skillRootCache = root;
  return root;
}

module.exports = { text, persona, skill, skillRoot, manifest };
