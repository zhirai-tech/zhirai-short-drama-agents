/**
 * ZHIRAI 运行时模块（发布版入口）
 * 只做四件事：逐段拼装密钥 → HKDF 派生 → 解两层信封 → 在内存里执行载荷模块。
 * 包内没有可读的密钥（只有 4 段高熵片段）、没有可读的解密后逻辑。
 *
 * 采用 CJS 是机制要求：cordis.patch.yml 的 !!js 表达式由 `new Function(...eval)` **同步**求值，
 * 不能用 await import()。因此这里用 module.exports 暴露同步接口。
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const _F = ["90BZshuEOKPB","Jea09TqE4GrT","Z+sMXUKCL2XH","3mJvpUg"];
const _S = Buffer.from("K+m6rBhf9QH47qyLMrMhwg==", 'base64');

// 逐段解码后按原顺序拼接成 32 字节主密钥（不能在 base64 字符串上直接拼接或重排）
const _M = Buffer.concat(_F.map((f) => Buffer.from(f, 'base64')));

const _k = (label) =>
  Buffer.from(crypto.hkdfSync('sha256', _M, _S, Buffer.from(label, 'utf8'), 32));

const _open = (blob, key) => {
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
};

let _mod = null;
function _load() {
  if (_mod) return _mod;
  const outer = _open(fs.readFileSync(path.join(__dirname, "_7f2c/9a1")), _k('outer-v1'));
  const inner = JSON.parse(_open(outer, _k('inner-v1')).toString('utf8'));
  const m = { exports: {} };
  // 真正执行的是解密出来的模块源码（包内没有它的明文）
  new Function('module', 'exports', 'require', inner.m)(m, m.exports, require);
  _mod = m.exports;
  return _mod;
}

module.exports = {
  T: (s) => _load().T(s),
  R: () => _load().R(),
  L: () => _load().L(),
  P: () => _load().P(),
};
