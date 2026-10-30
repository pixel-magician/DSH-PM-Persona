/**
 * 插件入口：把人格卡挂进 DSH。
 *
 * - 静态卡 → systemPrompt.section（只在编辑时变，缓存友好）
 * - 场景 / 心情 / 正史 / 长期记忆 → systemPrompt.context（每轮追加）
 * - 模型工具 pm-persona、斜杠命令 /persona、前端 REST
 * - 会话 fork 继承绑定；子 agent 一律不注入
 */

import { DOMAIN_SPEC, ROUTE_PATH } from './constants.js'
import { PersonaStore } from './store.js'
import { createPersonaTool, wrapToolExecute } from './tool.js'
import { createPersonaCommand } from './command.js'
import { createApiHandler } from './http.js'

export const inject = ['storageDomain', 'systemPrompt', 'tools']

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(DOMAIN_SPEC)
  ctx.effect(() => () => domain.close(), 'pm-persona: close domain')
  const store = new PersonaStore(ctx, domain)

  // 静态自我认知：只随卡片编辑变化，挂在系统提示层。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'pm-persona:card',
    order: -500,
    interpolate: false,
    text: (context) => {
      try {
        const session = context?.agent?.session
        if (session === undefined) return ''
        if (session.header?.origin === 'subagent') return ''
        return store.cardForSession(session.id)
      } catch (error) {
        ctx.logger?.warn?.('pm-persona: card assembly failed: %o', error)
        return ''
      }
    },
  }), 'pm-persona: prompt section')

  // 每轮变化的部分：作为运行时上下文追加，不破坏提示缓存。
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'pm-persona:moment',
    order: 905,
    interpolate: false,
    text: (context) => {
      try {
        const session = context?.agent?.session
        if (session === undefined) return ''
        if (session.header?.origin === 'subagent') return ''
        return store.runtimeForSession(session.id)
      } catch (error) {
        ctx.logger?.warn?.('pm-persona: runtime assembly failed: %o', error)
        return ''
      }
    },
  }), 'pm-persona: prompt context')

  const tool = wrapToolExecute(createPersonaTool(ctx, store))
  ctx.effect(() => ctx.tools.register(tool), 'pm-persona: tool')

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(
      () => commandCtx.commands.register(createPersonaCommand(store)),
      'pm-persona: command',
    )
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: createApiHandler(webCtx, store),
      }),
      'pm-persona: http api',
    )
  })

  // fork 出来的会话复制父会话的绑定、场景和正史。
  ctx.effect(() => ctx.on('session/created', (session) => {
    void store.inherit(session).catch((error) => {
      ctx.logger?.warn?.('pm-persona: failed to inherit persona: %o', error)
    })
  }), 'pm-persona: fork inheritance')

  // 自动记忆：卡上开了 autoMemory 才跑；store 内部按会话 10 分钟节流。
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    const active = store.active(session?.id)
    if (active === null) return
    if (active.persona.autoMemory !== true) return
    void store.harvestIfDue(session.id, session, active.persona.id).catch((error) => {
      ctx.logger?.warn?.('pm-persona: auto memory harvest failed: %o', error)
    })
  }), 'pm-persona: auto memory')

  ctx.logger?.info?.('pm-persona: ready (domain %s)', DOMAIN_SPEC.name)
}
