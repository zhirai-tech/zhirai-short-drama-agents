/**
 * ZHIRAI 短剧 Agent 插件 —— Host 入口
 *
 * 这个 Host 行的职责只有两件事：
 *   1) 让插件在 Harness 插件管理里是一个**可见、可禁用**的独立单元（元数据来自 package.json + locale/）；
 *   2) 把本插件的 Agent 架构清单**暴露成一个只读服务**（ctx.zhiraiAgents），
 *      供诊断与插件 UI 读取；Agent 本身由本 bundle 的 preset 声明交付（见 cordis.patch.yml）。
 *
 * 刻意不做：
 *   - 不注册任何模型/Provider（模型一律由 Harness 选择，见 agents/definitions.js 的 MODEL_BINDING）；
 *   - 不实现自己的模型调用、不实现第二套 Agent 循环；
 *   - 不读写源 AI 短剧项目的任何路径（插件独立安装即可运行）。
 */
import { ZHIRAI_AGENTS, ZHIRAI_TOPOLOGY, ZHIRAI_CONTEXT_NEEDS, TOOL_ADAPTERS, MODEL_BINDING, LANGUAGE_DIRECTIVE } from './agents/definitions.js';

export const name = 'zhirai-short-drama-agents';

export const inject = [];

/**
 * 刻意不导出 `Config`：Cordis 的 Config 必须是 schemastery schema（需要 `validate`），
 * 本插件没有任何需要校验的配置项，因此不声明 —— 声明一个无效 Config 会让整行导入失败
 * （实测：`TypeError: Cannot read properties of undefined (reading 'validate')`，
 *  结果是 Agent 退回宿主 persona，插件形同未装）。
 * 语言指令改用固定常量，与源系统 prompt 里 `{language}` 的展开值一致。
 */

/**
 * Agent 架构的只读视图（给诊断/UI 用）。
 * 注意：这是**数据**，不是 Agent 本体；Agent 本体是 cordis.patch.yml 里的 6 个 preset。
 */
export function describeArchitecture() {
  return {
    agents: ZHIRAI_AGENTS.map((a) => ({
      presetId: a.presetId,
      role: a.role,
      name: a.name,
      description: a.description,
      toolCalling: a.toolCalling,
      userFacing: a.userFacing,
      sourceTools: a.sourceTools,
      dispatches: a.dispatches,
      stages: a.stages,
    })),
    topology: ZHIRAI_TOPOLOGY,
    contextNeeds: ZHIRAI_CONTEXT_NEEDS,
    toolAdapters: TOOL_ADAPTERS,
    modelBinding: MODEL_BINDING,
  };
}

export function apply(ctx, config = {}) {
  // 只读服务：把 Agent 架构清单挂到 ctx 上，便于诊断与其它插件读取。
  // 用 ctx.effect 注册并返回清理函数（DSH 的插件资源纪律）。
  ctx.effect(() => {
    const service = {
      /** 6 个 Agent 的身份/关系摘要 */
      list: () => describeArchitecture().agents,
      /** 完整架构（含调度关系、阶段数据流、上下文需求、工具映射、模型策略） */
      architecture: () => describeArchitecture(),
      /** 源系统 prompt 里 {language} 的展开值 */
      languageDirective: () => String(config.languageDirective || LANGUAGE_DIRECTIVE),
    };
    const dispose = typeof ctx.provide === 'function' ? ctx.provide('zhiraiAgents', service) : undefined;
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  });
}

export default { name, inject, apply };
