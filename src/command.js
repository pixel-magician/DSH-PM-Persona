/**
 * 斜杠命令：/pm-persona [list|show|use|new|off|remember|notes|forget|pin|enrich]
 * 和工具动作是同一套 store，只是没有模型参与。
 */

import { errorText, formatNoteTime } from './util.js'
import { showPersonaText } from './runtime.js'
import { toolListMessage } from './tool.js'
import { enrichPersona } from './enrich.js'

function formatNotesText(state) {
  const notes = Array.isArray(state?.notes) ? state.notes : []
  if (notes.length === 0) return '当前会话还没有正史。'
  return [
    `当前会话正史（${notes.length} 条）：`,
    ...notes.map((note, index) => {
      const when = formatNoteTime(note?.at) || '未知时间'
      const pin = note?.pinned === true ? ' · 📌 固定' : ''
      return `- [${note?.id ?? index}] ${when}${pin}\n  ${note?.text ?? ''}`
    }),
  ].join('\n')
}

const USAGE = '用法：/pm-persona [list|show [name]|use <name>|new <name>|off|remember <text>|notes|forget <id>|pin <id>|enrich]'

export function createPersonaCommand(store) {
  return {
    name: 'pm-persona',
    description: '查看或切换当前会话的人格',
    input: { hint: '[list|show [name]|use <name>|new <name>|off|remember <text>|notes|forget <id>|pin <id>|enrich]' },
    handler: async ({ agent, rawInput }) => {
      const raw = String(rawInput ?? '').trim()
      const space = raw.search(/\s/)
      const verb = (space === -1 ? raw : raw.slice(0, space)).toLowerCase()
      const arg = space === -1 ? '' : raw.slice(space).trim()
      try {
        if (verb === '' || verb === 'list') {
          const personas = store.listPersonas()
          return { kind: 'success', text: toolListMessage(personas) }
        }
        if (verb === 'show') {
          const persona = arg === ''
            ? store.active(agent.id)?.persona
            : store.requirePersona(arg)
          if (persona === undefined) return { kind: 'error', text: '当前会话还没有绑定人格。' }
          const state = store.active(agent.id)?.persona?.id === persona.id
            ? store.getState(agent.id, persona.id)
            : undefined
          return { kind: 'success', text: showPersonaText(persona, state) }
        }
        if (verb === 'use') {
          if (arg === '') return { kind: 'error', text: '用法：/pm-persona use <名字或 id>' }
          const { persona } = await store.usePersona(agent.id, arg)
          return { kind: 'success', text: `已切换到「${persona.name}」。` }
        }
        if (verb === 'new') {
          if (arg === '') return { kind: 'error', text: '用法：/pm-persona new <名字>' }
          const persona = await store.createPersona({ name: arg })
          await store.usePersona(agent.id, persona.id)
          return { kind: 'success', text: `已创建并绑定「${persona.name}」。在聊天里继续描述设定即可。` }
        }
        if (verb === 'off') {
          await store.off(agent.id)
          return { kind: 'success', text: '已关闭当前会话的人格。' }
        }
        if (verb === 'remember') {
          if (arg === '') return { kind: 'error', text: '用法：/pm-persona remember <要记住的事>' }
          const { state, note } = await store.remember(agent.id, arg, { pinned: false })
          return { kind: 'success', text: `已记入正史（共 ${state.notes.length} 条，id: ${note.id}）。` }
        }
        if (verb === 'notes') {
          const { persona } = store.requireActive(agent.id)
          return { kind: 'success', text: formatNotesText(store.getState(agent.id, persona.id)) }
        }
        if (verb === 'forget') {
          if (arg === '') return { kind: 'error', text: '用法：/pm-persona forget <id 或原文片段>' }
          const { state, removed } = await store.forget(agent.id, arg)
          return { kind: 'success', text: `已删除「${removed.text.slice(0, 60)}」，剩余 ${state.notes.length} 条。` }
        }
        if (verb === 'pin') {
          if (arg === '') return { kind: 'error', text: '用法：/pm-persona pin <id 或原文片段>' }
          const { note } = await store.setNotePinned(agent.id, arg, true)
          return { kind: 'success', text: `已固定「${note.text.slice(0, 60)}」。` }
        }
        if (verb === 'enrich') {
          const active = store.active(agent.id)
          if (active === null) return { kind: 'error', text: '当前会话还没有绑定人格。' }
          const result = await enrichPersona(store.ctx, store, agent, active.persona.id, false)
          return {
            kind: 'success',
            text: result.changed
              ? `已补完：${result.filled.join('、')}。下一步起生效。`
              : '字段已经比较完整，没有可补的。',
          }
        }
        return { kind: 'error', text: USAGE }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  }
}
