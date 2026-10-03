/**
 * Host 插件独立加载验证 —— 本插件的 index.js 在**没有任何源 AI 短剧项目**的情况下能否正常工作。
 *
 * 做法：在一个临时目录里只复制插件包（不含源项目），用假 ctx 模拟 DSH 的插件应用契约
 * （apply(ctx, config) + ctx.effect 清理函数 + ctx.provide），然后调用服务方法。
 * 这直接验证任务书 §十「插件不得依赖原 AI 短剧项目」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// 1) 复制插件包到临时目录（模拟安装后的 node_modules/<pkg>，不含源项目）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhirai-plugin-standalone-'));
const dest = path.join(tmp, 'node_modules', '@local', 'zhirai-short-drama-agents');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(root, dest, { recursive: true });

// 2) 模块内的相对 import 必须全部解析到插件包内部
const mod = await import(pathToFileURL(path.join(dest, 'index.js')).href);
const fail = [];
const ok = [];
const check = (c, m) => (c ? ok.push(m) : fail.push(m));

check(typeof mod.apply === 'function', 'index.js 导出 apply(ctx, config)');
// Config 是可选导出；导出则必须是 schemastery schema（普通对象会让 Cordis resolveConfig 抛错）
if (mod.Config !== undefined) {
  check(typeof mod.Config?.validate === 'function' || typeof mod.Config?.['~standard'] === 'object', 'Config 是 schemastery schema');
} else {
  ok.push('未导出 Config（本插件无配置项）');
}

// 3) 模拟 DSH 插件契约
const effects = [];
const provided = new Map();
const ctx = {
  effect(fn) { const dispose = fn(); effects.push(dispose); return () => {}; },
  provide(name, service) { provided.set(name, service); return () => provided.delete(name); },
};
mod.apply(ctx, { languageDirective: 'Reply in the language the user writes in.' });
check(effects.length === 1, `apply 注册了 1 个 effect（得到 ${effects.length}）`);
check(provided.has('zhiraiAgents'), 'apply 通过 ctx.provide 暴露 zhiraiAgents 服务');

const svc = provided.get('zhiraiAgents');
const list = svc.list();
check(Array.isArray(list) && list.length === 6, `服务返回 6 个 Agent（得到 ${list?.length}）`);
const arch = svc.architecture();
check(arch.topology?.root === 'DIRECTOR', 'topology.root = DIRECTOR');
check((arch.topology?.dispatchEdges || []).length === 5, `派活边 = 5（得到 ${arch.topology?.dispatchEdges?.length}）`);
check((arch.topology?.stagePipeline || []).length === 9, `阶段数据流 = 9（得到 ${arch.topology?.stagePipeline?.length}）`);
check(arch.modelBinding?.declaredProviders?.length === 0, '未声明任何 provider（模型交由 Harness 选择）');
check(arch.modelBinding?.declaredModels?.length === 0, '未声明任何 model（模型交由 Harness 选择）');
check(svc.languageDirective() === 'Reply in the language the user writes in.', 'config.languageDirective 已生效');

// 4) 关键：**运行期**不得依赖源项目。
// 说明性文字（"来源：apps/api/..." 这类 provenance 注释）是允许的 —— 这里只查真正的运行期引用。
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const files = walk(dest).filter((f) => /\.(js|mjs|json|yml)$/.test(f));
const runtimeFiles = files.filter((f) => /\.(js|mjs)$/.test(f) && !/scripts[\\/](build-bundle|verify-standalone|compare-with-shipped|validate-bundle)\.mjs$/.test(f));
const leaks = [];
for (const f of runtimeFiles) {
  const t = fs.readFileSync(f, 'utf8');
  // 去掉注释行后再判定，避免 provenance 注释造成误报
  const code = t
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ''))
    .join('\n');
  if (/(?:import|require)\s*\(?\s*['"][^'"]*(?:AI-Content-OS|apps[\\/]api|dev\.db)/.test(code)) leaks.push(`${path.relative(dest, f)}: import 源项目`);
  if (/(?:readFileSync|readFile|existsSync|createReadStream)\s*\(\s*['"`][^'"`]*(?:AI-Content-OS|apps[\\/]api|dev\.db)/.test(code)) leaks.push(`${path.relative(dest, f)}: 运行期读取源项目`);
}
check(runtimeFiles.length > 0, `检查了 ${runtimeFiles.length} 个运行期 JS 文件`);
check(leaks.length === 0, `插件运行期无任何源项目依赖${leaks.length ? `（发现：${leaks.join(', ')}）` : ''}`);

// 5) 清理
for (const d of effects) { if (typeof d === 'function') d(); }fs.rmSync(tmp, { recursive: true, force: true });

console.log(`通过 ${ok.length} 项：`);
for (const o of ok) console.log('  ✓ ' + o);
if (fail.length) {
  console.log(`\n失败 ${fail.length} 项：`);
  for (const f of fail) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\n✅ Host 插件可在无源项目环境下独立加载运行（已清理临时目录）');
