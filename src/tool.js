/**
 * 模型能调用的 pm-persona 工具。
 *
 * 一个 action 一把开关；输出统一走 jsonSafe，保证无损 JSON。
 * 子 agent 不继承人格，也不允许调用这个工具。
 */

import {
  MEME_FREQUENCY_DEFAULT,
  TEXT_FIELDS,
} from './constants.js'
import { jsonSafe } from './util.js'
import { summaryOf } from './card.js'
import { formatNoteTime } from './util.js'
import { memoryClarity } from './memory.js'
import { showPersonaText } from './runtime.js'
import { digestMemories, enrichPersona } from './enrich.js'
import { ownerOfSession } from './store.js'

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

function toolPatch(args) {
  const patch = {}
  for (const field of TEXT_FIELDS) {
    if (args[field] !== undefined) patch[field] = args[field]
  }
  if (args.tags !== undefined) patch.tags = args.tags
  if (args.maxReplyChars !== undefined) patch.maxReplyChars = args.maxReplyChars
  if (args.injectLore !== undefined) patch.injectLore = args.injectLore
  if (args.injectTags !== undefined) patch.injectTags = args.injectTags
  if (args.useActions !== undefined) patch.useActions = args.useActions
  if (args.useMemes !== undefined) patch.useMemes = args.useMemes
  if (args.memeFrequency !== undefined) patch.memeFrequency = args.memeFrequency
  if (args.autoMemory !== undefined) patch.autoMemory = args.autoMemory
  if (args.archived !== undefined) patch.archived = args.archived
  return patch
}

export function toolListMessage(personas) {
  if (personas.length === 0) return '人格库还是空的。'
  return [
    `人格库（${personas.length}）：`,
    ...personas.map((persona) => `- ${persona.name} (${persona.id})${persona.summary ? `：${persona.summary}` : ''}`),
  ].join('\n')
}

export function createPersonaTool(ctx, store) {
  return {
    name: 'pm-persona',
    description: 'Create, inspect, or refine the active persona card for this session. The card is injected as the model\'s own self-knowledge, so fill it with real personality: traits, tastes, habits and history, not just a label. Use create when the user starts a character or asks to save an initial persona; include all known fields. Use update when the user refines a trait or a durable new trait is established in the conversation; changes apply from the next model step. The card keeps two audiences apart on purpose: relationship is how the character treats its master (the person who bound this card; in group chat, whoever is marked 主人), relationshipOthers is how it treats everyone else. When the user wants the attitudes separated, fill both. Each card is headed by a compact 【PERSONA_LOAD】 tag block (auto-derived from the fields unless tagCode is set): write tags as one anchor per line, never as prose. Use remember for facts that happened in the story, state for scene/mood/relationship changes, notes to review what this session remembers, forget/pin to curate those notes, enrich when the card is too thin to act from (it calls the current model to fill missing personality fields), and use/off only when the user explicitly asks to switch or stop the role-play. Do not silently replace the user\'s chosen persona.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [
            'list', 'show', 'create', 'update', 'remember', 'notes', 'forget', 'pin',
            'state', 'use', 'off', 'enrich', 'memory', 'memorize', 'digest', 'forget-memory',
          ],
          description: 'The operation to perform.',
        },
        id: { type: 'string', description: 'Persona id or exact name. Omit to address the active persona, except for use.' },
        name: { type: 'string', description: 'Display name. Required for create.' },
        summary: { type: 'string', description: 'One-line premise.' },
        masterName: { type: 'string', description: 'What the character calls its master. Default 主人; set something else (哥哥 / 老板 / 爸爸) to pin a custom form of address — only the custom value is injected.' },
        tagCode: { type: 'string', description: 'Format-first anchor block in the viral 【PERSONA_LOAD】 register: the 【PERSONA_LOAD】 header followed by one uppercase TAG_value per line (SELF_CLAIM_x, IDENTITY_x, TO_MASTER_x, TO_OTHERS_x, BOUNDARY_x…), one anchor per line, no prose. Leave empty to derive it from the card automatically.' },
        injectTags: { type: 'boolean', description: 'Whether to inject the tag anchor block into the self-knowledge card. Default true.' },
        useActions: { type: 'boolean', description: 'Whether replies may include a short action beat in full-width brackets, e.g. （搬小板凳）. Default false.' },
        useMemes: { type: 'boolean', description: 'Whether the character may send memes/stickers through the send_meme tool. Default false.' },
        memeFrequency: { type: 'number', description: `Sticker rate as a percentage of replies, 0-100 (default ${MEME_FREQUENCY_DEFAULT}). Only used when useMemes is true.` },
        autoMemory: { type: 'boolean', description: 'Whether the model should proactively write long-term memories from what the user says. Default false.' },
        identity: { type: 'string', description: 'Who they are: role, age/species, and the one-line anchor of their self-image.' },
        traits: { type: 'string', description: 'Personality traits: temperament, contradictions, how they react under pressure.' },
        voice: { type: 'string', description: 'Tone, rhythm, vocabulary, verbal tics, forms of address, avoid list.' },
        likes: { type: 'string', description: 'Things, activities and sensations this character genuinely enjoys.' },
        dislikes: { type: 'string', description: 'Things they avoid, fear or get irritated by.' },
        habits: { type: 'string', description: 'Recurring habits, mannerisms and small rituals.' },
        drives: { type: 'string', description: 'Goals, fears, values, contradictions, what they want from the scene.' },
        relationship: { type: 'string', description: 'How they treat their master — the person who picked them and bound this card: forms of address, closeness, how they obey or push back, what they would do for the master.' },
        relationshipOthers: { type: 'string', description: 'How they treat everyone who is not the master — group members, strangers, guests, onlookers: politeness, distance, wariness or teasing. Keep it clearly different from relationship.' },
        boundaries: { type: 'string', description: 'Hard limits, taboos, topics they deflect, behavior they never do.' },
        knowledge: { type: 'string', description: 'What they know and do not know; prevents anachronistic or omniscient behavior.' },
        examples: { type: 'string', description: 'Two to four short example lines that anchor the voice.' },
        lore: { type: 'string', description: 'Background and personal history. Injected as the character\'s own memories (up to a budget) unless injectLore is false.' },
        injectLore: { type: 'boolean', description: 'Whether to inject the background lore into the self-knowledge card. Default true.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for the library.' },
        maxReplyChars: { type: 'number', description: 'Maximum characters for one visible reply. 0 means unlimited; typical values are 200-800.' },
        note: { type: 'string', description: 'For remember: the canon fact to add to this session.' },
        noteId: { type: 'string', description: 'For forget/pin: the note id (or a unique fragment of its text).' },
        memory: { type: 'string', description: "For memorize: one sentence to keep in the card's long-term memory (cross-session). For forget-memory: an id or text fragment." },
        memoryId: { type: 'string', description: 'For forget-memory: the memory id (or a unique fragment of its text).' },
        importance: { type: 'number', description: 'For memorize: 0-5, how much this matters. Higher importance decays slower; default 3.' },
        kind: { type: 'string', description: 'For memorize: fact | preference | plan | event | pattern. Default fact.' },
        firstMet: { type: 'boolean', description: 'For memorize: mark this as the first meeting; it never decays and always ranks first.' },
        owner: { type: 'string', description: 'For memorize: whose memory this is (e.g. qq:591396639). Omit to auto-detect from the message prefix of the current turn.' },
        pinned: { type: 'boolean', description: 'For remember/pin: keep this fact in the turn-by-turn runtime context.' },
        scene: { type: 'string', description: 'For state: current place, time, and situation.' },
        mood: { type: 'string', description: 'For state: current emotional temperature.' },
        archived: { type: 'boolean', description: 'For update: archive or unarchive the card.' },
        overwrite: { type: 'boolean', description: 'For enrich: rewrite existing non-empty fields too, not just fill the gaps.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          persona: { type: 'object', additionalProperties: true },
          personas: { type: 'array', items: { type: 'object', additionalProperties: true } },
          state: { type: 'object', additionalProperties: true },
          capsule: { type: 'string' },
        },
        required: ['ok', 'message'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
    },
    isConcurrencySafe: () => false,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('persona 需要当前会话。')
      if (agent.session?.header?.origin === 'subagent') {
        throw new Error('子代理不继承人格，也不修改人格卡。')
      }
      const sessionId = agent.id
      const action = String(args.action ?? '').toLowerCase()

      if (action === 'list') {
        const personas = store.listPersonas()
        return { ok: true, message: toolListMessage(personas), personas }
      }

      if (action === 'show') {
        const ref = args.id ?? store.active(sessionId)?.persona?.id
        if (ref === undefined) throw new Error('当前会话还没有绑定人格，也没有指定要查看的人格。')
        const persona = store.requirePersona(ref)
        const active = store.active(sessionId)
        const isActive = active?.persona?.id === persona.id
        const preview = store.preview(persona.id, sessionId)
        const state = isActive ? store.getState(sessionId, persona.id) : undefined
        const body = isActive
          ? `${showPersonaText(persona, state)}\n\n--- injected self-cognition ---\n${preview.capsule}`
          : showPersonaText(persona)
        return { ok: true, message: body, persona, capsule: isActive ? preview.capsule : undefined }
      }

      if (action === 'create') {
        const persona = await store.createPersona(toolPatch(args))
        await store.usePersona(sessionId, persona.id)
        return {
          ok: true,
          message: `已创建并绑定人格「${persona.name}」。从下一步起，它会以这份自我认知说话；可以用 update 继续完善。`,
          persona: summaryOf(persona),
          capsule: store.compileForSession(sessionId),
        }
      }

      if (action === 'update') {
        const active = store.active(sessionId)
        const ref = args.id ?? active?.persona?.id
        if (ref === undefined) throw new Error('当前会话还没有绑定人格。先用 create 创建一个人格。')
        const persona = await store.updatePersona(store.requirePersona(ref).id, toolPatch(args))
        if (active?.persona?.id === persona.id) {
          await store.usePersona(sessionId, persona.id)
        }
        return {
          ok: true,
          message: `已更新人格「${persona.name}」到 revision ${persona.revision}。下一步起生效。`,
          persona: summaryOf(persona),
          capsule: active?.persona?.id === persona.id ? store.compileForSession(sessionId) : undefined,
        }
      }

      if (action === 'remember') {
        const { state, note } = await store.remember(sessionId, args.note, { pinned: args.pinned === true })
        return {
          ok: true,
          message: `已记入当前人格的会话正史（共 ${state.notes.length} 条，本条 id: ${note.id}）。${note.pinned ? '并已固定在每轮上下文里。' : ''}`,
          capsule: store.compileForSession(sessionId),
          state,
        }
      }

      if (action === 'notes') {
        const { persona } = store.requireActive(sessionId)
        const state = store.getState(sessionId, persona.id)
        return { ok: true, message: formatNotesText(state), state }
      }

      if (action === 'memory') {
        const { persona } = store.requireActive(sessionId)
        const records = store.listMemories(persona.id)
        if (records.length === 0) return { ok: true, message: '这张卡还没有长期记忆。' }
        const lines = records
          .map((record) => {
            const clarity = Math.round(memoryClarity(record) * 100)
            const when = formatNoteTime(record.createdAt)
            return `- [${record.id}] ${when} · 重要度 ${record.importance} · 鲜活 ${clarity}%${record.pinned ? ' · 📌' : ''}${record.firstMet ? ' · 初遇' : ''}\n  ${record.text.slice(0, 120)}`
          })
          .join('\n')
        return { ok: true, message: `长期记忆（${records.length} 条）：\n${lines}` }
      }

      if (action === 'memorize') {
        const { persona } = store.requireActive(sessionId)
        const text = String(args.memory ?? args.note ?? '').trim()
        if (text === '') throw new Error('要记什么？用 memory 传一句话。')
        const { record, count } = await store.rememberLong(persona.id, {
          text,
          kind: args.kind,
          importance: args.importance,
          pinned: args.pinned === true,
          firstMet: args.firstMet === true,
          owner: typeof args.owner === 'string' && args.owner !== ''
            ? args.owner
            : ownerOfSession(store.session(sessionId)),
          tags: args.tags,
        }, sessionId)
        return {
          ok: true,
          message: `已写入「${persona.name}」的长期记忆（共 ${count} 条，id: ${record.id}，重要度 ${record.importance}）。`,
          capsule: store.compileForSession(sessionId),
        }
      }

      if (action === 'digest') {
        const { persona } = store.requireActive(sessionId)
        const result = await digestMemories(ctx, store, agent, persona.id, sessionId)
        const lines = result.added.map((record) => `- ${record.text}`).join('\n')
        return {
          ok: true,
          message: result.added.length === 0
            ? '这段对话里没看出足够稳定的规律，这次没写新的结论。'
            : `归纳出 ${result.added.length} 条，已写入「${persona.name}」：\n${lines}`,
          capsule: store.compileForSession(sessionId),
        }
      }

      if (action === 'forget-memory') {
        const { persona } = store.requireActive(sessionId)
        const { removed, count } = await store.forgetLong(persona.id, args.memoryId ?? args.memory)
        return {
          ok: true,
          message: `已删除一条长期记忆：「${removed.text.slice(0, 60)}」。剩余 ${count} 条。`,
          capsule: store.compileForSession(sessionId),
        }
      }

      if (action === 'forget') {
        const { state, removed } = await store.forget(sessionId, args.noteId ?? args.note)
        return {
          ok: true,
          message: `已删除一条正史：「${removed.text.slice(0, 60)}」。剩余 ${state.notes.length} 条。`,
          capsule: store.compileForSession(sessionId),
          state,
        }
      }

      if (action === 'pin') {
        const { state, note } = await store.setNotePinned(sessionId, args.noteId ?? args.note, args.pinned !== false)
        return {
          ok: true,
          message: note.pinned ? '已固定这条正史，它会进入每轮上下文。' : '已取消固定这条正史。',
          capsule: store.compileForSession(sessionId),
          state,
        }
      }

      if (action === 'state') {
        const state = await store.updateState(sessionId, args)
        return {
          ok: true,
          message: '已更新当前场景状态。下一步起生效。',
          capsule: store.compileForSession(sessionId),
          persona: store.active(sessionId)?.persona,
          state,
        }
      }

      if (action === 'use') {
        const ref = args.id ?? args.name
        if (ref === undefined) throw new Error('use 需要 id 或 name。')
        const { persona } = await store.usePersona(sessionId, ref)
        return {
          ok: true,
          message: `当前会话已切换到人格「${persona.name}」。它的自我认知会从下一步起完整注入。`,
          persona: summaryOf(persona),
          capsule: store.compileForSession(sessionId),
        }
      }

      if (action === 'off') {
        await store.off(sessionId)
        return { ok: true, message: '已关闭当前会话的人格，恢复默认助手。' }
      }

      if (action === 'enrich') {
        const active = store.active(sessionId)
        const ref = args.id ?? active?.persona?.id
        if (ref === undefined) throw new Error('当前会话还没有绑定人格。先用 create 创建一个人格。')
        const result = await enrichPersona(ctx, store, agent, ref, args.overwrite === true)
        if (!result.changed) {
          return {
            ok: true,
            message: `「${result.persona.name}」的字段已经比较完整，这次没有改动。若要重写，请传 overwrite: true。`,
            persona: summaryOf(result.persona),
          }
        }
        return {
          ok: true,
          message: `已补完「${result.persona.name}」的自我认知：${result.filled.join('、')}。下一步起会以更完整的自我认知说话。`,
          persona: summaryOf(result.persona),
          capsule: store.compileForSession(sessionId),
        }
      }

      throw new Error(`不支持的人格操作：${action}`)
    },
  }
}

/** 包一层：结果统一做 JSON 安全化。 */
export function wrapToolExecute(tool) {
  const rawExecute = tool.execute
  tool.execute = async (args, exec) => jsonSafe(await rawExecute(args, exec))
  return tool
}
