/**
 * ZHIRAI Capability Discovery Adapter —— 极薄的一层，只做「读取」，不做任何实现。
 *
 * 它存在的唯一理由：Harness Runtime 已经拥有能力注册表（`ctx.tools` / `ctx.skills` /
 * `ctx.agentPresets` / `ctx.sandboxPolicy` …）。ZHIRAI **不复制**这些注册表，也不维护
 * 「本插件支持哪些工具」的静态白名单，只把「当前 Runtime 实际授予这个 Agent 的能力」
 * **如实读取出来**交给总导演。
 *
 * 因此：
 *   - 权限 / 可见性 / 注册来源全部由 Harness 决定（本文件不做任何 allow/deny 判断）；
 *   - Harness 新增能力后，只要进入当前 Runtime 并授予该 Agent，ZHIRAI 无需改代码即可发现；
 *   - 本文件不注册业务工具，只注册一个只读的 `capabilities` 工具作为发现入口。
 *
 * ── 一个必须记住的机制要点（实测，不是推断）──
 * `ctx.tools.schemas()` **不传 scope 时只返回宿主 global 层**：在 preset 作用域里调用它会得到
 * 0 个工具（实测 `count=0`）。必须传入「查看者 scope」——也就是 **Agent 对象本身**
 * （`exec.agent`；官方 `dsh-tool-skill` 同样用 `scope: exec.agent`）。
 * 传入 agent 后同一次实验得到 13 个工具。`tools.get(name, scope)` 同理。
 *
 * 另一个要点：preset 子树里 `provide()` 服务到 root realm 会让整个 preset mount 失败
 * （`Preset services require isolate realms`）。本适配器只**读**宿主服务，不提供任何服务。
 */

export const name = 'zhirai-capability-discovery';

/** 只做可见性探测，绝不修改任何东西。 */
const visible = (ctx, key) => {
  try {
    return ctx.get(key) !== undefined;
  } catch {
    return false;
  }
};

/**
 * 读取当前 Runtime 授予 `scope`（Agent 对象）的能力。
 * @param {object} ctx - preset 作用域内的 Cordis context
 * @param {object} scope - 查看者 scope（Agent 对象本身）
 * @param {AbortSignal} [signal]
 */
export async function discover(ctx, scope, signal) {
  const out = {
    tools: [],
    skills: [],
    presets: [],
    agents: [],
    policies: [],
    services: [],
    unavailable: [],
  };

  // ── 1. Tools：Harness 官方工具注册表（global 层 ∪ 祖先层 ∪ 本层，已扣除 restrict）──
  // scope 必须是 Agent 对象，否则只会拿到 global 层（在 preset 里等于空集）。
  if (visible(ctx, 'tools')) {
    try {
      const rows = ctx.get('tools').schemas(scope) ?? [];
      out.tools = rows
        .map((s) => ({ name: s?.name, description: s?.description }))
        .filter((r) => r.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } catch (error) {
      out.unavailable.push({ capability: 'tools', reason: String(error?.message || error) });
    }
  } else {
    out.unavailable.push({ capability: 'tools', reason: 'ctx.tools not visible in this scope' });
  }

  // ── 2. Skills：分层注册表（global 层与查看 scope 链合并，nearest layer 胜出）──
  if (visible(ctx, 'skills')) {
    try {
      const cwd = scope?.session?.header?.cwd;
      const rows = (await ctx.get('skills').list({ scope, ...(cwd ? { cwd } : {}), ...(signal ? { signal } : {}) })) ?? [];
      out.skills = rows
        .map((s) => ({
          name: s?.name,
          description: s?.description,
          source: s?.source,
          provider: s?.provider,
          modelInvocable: s?.invocation?.modelInvocable !== false,
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } catch (error) {
      out.unavailable.push({ capability: 'skills', reason: String(error?.message || error) });
    }
  } else {
    out.unavailable.push({ capability: 'skills', reason: 'ctx.skills not visible in this scope' });
  }

  // ── 3. Agents / presets：Harness 官方名册 ──
  if (visible(ctx, 'agentPresets')) {
    try {
      const rows = (await ctx.get('agentPresets').list()) ?? [];
      out.presets = rows.map((p) => ({ id: p?.id, name: p?.name, broken: p?.broken ?? null }));
    } catch (error) {
      out.unavailable.push({ capability: 'agentPresets', reason: String(error?.message || error) });
    }
  }
  if (visible(ctx, 'agents')) {
    try {
      out.agents = (ctx.get('agents').list() ?? []).map((a) => ({ id: a?.id }));
    } catch (error) {
      out.unavailable.push({ capability: 'agents', reason: String(error?.message || error) });
    }
  }

  // ── 4. 权限 / 沙箱：**只读** Harness 的策略，本插件不复制任何策略 ──
  if (visible(ctx, 'sandboxPolicy')) {
    try {
      const session = scope?.session;
      const resolved = ctx.get('sandboxPolicy').resolve(session ? { session } : {});
      out.policies.push({
        name: 'sandboxPolicy',
        mode: resolved?.mode ?? resolved?.sandbox ?? null,
        workspaceRoot: resolved?.workspaceRoot ?? null,
      });
    } catch (error) {
      out.unavailable.push({ capability: 'sandboxPolicy', reason: String(error?.message || error) });
    }
  } else {
    out.unavailable.push({ capability: 'sandboxPolicy', reason: 'not visible here (Harness still enforces it)' });
  }
  if (visible(ctx, 'fs')) {
    try {
      const fs = ctx.get('fs');
      out.policies.push({ name: 'fs', sandboxMode: fs?.sandboxMode ?? null });
    } catch (error) {
      out.unavailable.push({ capability: 'fs', reason: String(error?.message || error) });
    }
  }

  // ── 5. 其它 service：只报可见性，不假装可用 ──
  for (const key of ['shell', 'systemPrompt', 'jobs', 'web', 'attachments', 'userQuestions', 'workspace', 'mcp']) {
    out.services.push({ service: key, visible: visible(ctx, key) });
  }

  return out;
}

/** 压成一段给模型读的文本；完整参数定义由 Harness 的 tool schema 提供，这里不重复。 */
export function renderDiscovery(c) {
  const L = [];
  L.push('# 当前 Runtime 实际授予你的能力（本次读取，非固定清单）');
  L.push('');
  L.push(`Tools (${c.tools.length})：${c.tools.map((t) => t.name).join(', ') || '（无）'}`);
  L.push(`Skills (${c.skills.length})：${c.skills.map((s) => s.name).join(', ') || '（无）'}`);
  L.push(`Presets (${c.presets.length})：${c.presets.map((p) => p.id).join(', ') || '（无）'}`);
  L.push(`Live agents：${c.agents.length}`);
  if (c.policies.length) {
    L.push(`权限/沙箱（Harness 决定，本插件只读）：${c.policies.map((p) => `${p.name}=${JSON.stringify(p)}`).join(', ')}`);
  }
  const on = c.services.filter((s) => s.visible).map((s) => s.service);
  const off = c.services.filter((s) => !s.visible).map((s) => s.service);
  L.push(`其它可见 service：${on.join(', ') || '（无）'}`);
  if (off.length) L.push(`不可见 service（Harness 未授予本 Agent）：${off.join(', ')}`);
  if (c.unavailable.length) {
    L.push(`读取失败：${c.unavailable.map((u) => `${u.capability}(${u.reason})`).join('; ')}`);
  }
  L.push('');
  L.push('工具与技能的完整参数/调用方式由 Harness 直接提供，不需要在这里重复。');
  L.push('按任务选择上面真实存在的能力直接调用；清单之外的能力一律视为不可用，不要假设。');
  return L.join('\n');
}

export function apply(ctx) {
  // 注册只读发现工具：它不是业务工具，而是「能力发现」这个动作的入口
  // ——相当于 Harness 官方 cordis_inspect 的只读投影，让模型不必依赖记忆里的固定清单。
  ctx.effect(() => {
    if (!visible(ctx, 'tools')) return () => {};
    return ctx.get('tools').register({
      name: 'capabilities',
      description:
        'List the capabilities this Runtime actually grants to you right now: tools (as Harness resolves them for you), skills, agent presets, sandbox/permission policy, and visible services. ' +
        'Read-only discovery straight from the Harness registries — never a fixed list. Call it instead of assuming which capabilities exist.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        // scope 必须是 Agent 对象本身（exec.agent）；传 undefined 只会拿到 global 层。
        return renderDiscovery(await discover(ctx, exec?.agent, exec?.signal));
      },
    });
  });

  // 这些是 ZHIRAI 自己的**业务契约**（项目落盘结构 / 调度拓扑），Harness 无从提供，
  // 因此保留为静态配置，并与「动态能力发现」明确区分：它们不是能力清单。
  return { discover };
}

export default { name, apply };
