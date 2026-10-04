/**
 * ZHIRAI 短剧 Agent 插件 —— Host 入口（发布版）
 * 职责与开发版一致：让插件在 Harness 插件管理里可见/可禁用，并暴露只读架构服务。
 * 核心知识资产不以明文存在，正文由运行时模块解密后提供。
 */
export const name = 'zhirai-short-drama-agents';
export const inject = [];
export function apply(ctx) {
  ctx.effect(() => {
    const service = {
      list: () => [],
      architecture: () => ({ protected: true }),
      languageDirective: () => 'Reply in the language the user writes in.',
    };
    const dispose = typeof ctx.provide === 'function' ? ctx.provide('zhiraiAgents', service) : undefined;
    return () => { if (typeof dispose === 'function') dispose(); };
  });
}
export default { name, inject, apply };
