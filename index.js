/**
 * ZHIRAI 短剧 Agent 插件 —— Host 入口（受保护发布版）
 *
 * 与开发版职责相同：让插件在 Harness 插件管理里可见/可禁用，并暴露只读架构服务。
 * 差异：核心知识资产（persona / prompt / 拓扑）不在包内明文，只提供
 * 不含正文的元数据；正文由 prompts.cjs 在运行时解密。
 */
import { createRequire } from 'node:module';

export const name = 'zhirai-short-drama-agents';
export const inject = [];

const require = createRequire(import.meta.url);
const protectedRuntime = require('./prompts.cjs');

/** 不含任何 prompt 正文的架构元数据（审计/诊断用）。 */
export function describeArchitecture() {
  return {
    protected: true,
    assets: protectedRuntime.manifest().map((a) => ({ name: a.name, bytes: a.bytes })),
    note: 'Persona/prompt/skill bodies are sealed in assets/assets.enc.json and decrypted at runtime by prompts.cjs.',
  };
}

export function apply(ctx) {
  ctx.effect(() => {
    const service = {
      list: () => describeArchitecture().assets,
      architecture: () => describeArchitecture(),
      languageDirective: () => 'Reply in the language the user writes in.',
    };
    const dispose = typeof ctx.provide === 'function' ? ctx.provide('zhiraiAgents', service) : undefined;
    return () => { if (typeof dispose === 'function') dispose(); };
  });
}

export default { name, inject, apply };
