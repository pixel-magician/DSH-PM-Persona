/**
 * 每轮变化的那一半：场景、心情、此刻的关系、会话正史、长期记忆。
 * 作为运行时上下文追加在对话后面，不改写系统提示 —— 提示缓存不会被打穿。
 */

import { MAX_NOTE_CHARS, MAX_RUNTIME_CHARS, MASTER_NAME_DEFAULT, MEME_FREQUENCY_DEFAULT } from './constants.js'
import { clean, escapeAttribute, escapePersonaBody, formatNoteTime } from './util.js'
import { compileCard, deriveTagCode, masterNameOf } from './card.js'
import { noteId, selectNotes } from './notes.js'

export function compileRuntime(persona, state, query, current = Date.now(), memories = []) {
  if (persona === undefined || persona === null) return { text: '', trace: null }
  const blocks = []
  // 带人格的会话：思考过程一律中文。放最前面，避免被尾部截断吃掉。
  blocks.push([
    '[思考语言]',
    '你的内部推理与思考过程一律用中文写，不要用英文。',
  ].join('\n'))
  const scene = clean(state?.scene, 1000)
  if (scene !== '') blocks.push(`[Scene]\n${escapePersonaBody(scene)}`)
  const mood = clean(state?.mood, 200)
  if (mood !== '') blocks.push(`[Mood]\n${escapePersonaBody(mood)}`)
  const relationship = clean(state?.relationship, 500)
  if (relationship !== '' && relationship !== clean(persona.relationship, 500)) {
    blocks.push(`[Your standing with your master right now]\n${escapePersonaBody(relationship)}`)
  }

  const { picked, omitted, chars } = selectNotes(state, query, current)
  if (picked.length > 0) {
    blocks.push([
      '[Things you remember]',
      'These are your own experiences and commitments. Bring one up only when it is relevant; do not recite the list.',
      ...picked.map((note) => `- ${escapePersonaBody(note.line)}`),
    ].join('\n'))
  }

  if (Array.isArray(memories) && memories.length > 0) {
    blocks.push([
      '[Long-term memories]',
      '这些是你以前记下的、跨会话还在的事。贴题时自然提一句，不要罗列。',
      '括号里的「已提到 N 次」表示这件事反复出现过，不是随手一记。',
      ...memories.map((line) => `- ${escapePersonaBody(line)}`),
    ].join('\n'))
  }

  // 自动记忆：不靠正则猜，改成让模型按上下文自己判断（只在卡上开了才出现）。
  if (persona.autoMemory === true) {
    blocks.push([
      '[记忆]',
      '对方说的这些值得跨会话记住：关于他自己的事（在哪、做什么、养了什么）、明确的偏好（喜欢什么、讨厌什么）、和没兑现的约定。',
      '碰到就调 pm-persona 工具、action 用 memorize 记一条，一句话说清。一轮最多记一条。',
      '这轮的任务细节、临时状态、情绪不要记；已经在上面列出的事不要重复记。',
      '如果同一件事已经反复出现——上面标着「已提到 N 次」，或者你在这段对话里已经劝过好几次——可以记一条归纳，action 仍用 memorize，kind 写 pattern。',
      '归纳只写看得出来的习惯或规律，例如「常年熬夜，劝睡很少照做，顺着聊更有效」。不要评价人品，别写「懒」「不听话」这类判断。',
    ].join('\n'))
  }

  const trace = {
    at: current,
    query: String(query ?? '').slice(0, 160),
    picked: picked.map((note) => ({ id: note.id, reason: note.reason, hits: note.hits })),
    omitted: omitted.slice(0, 20),
    chars,
    memories: Array.isArray(memories) ? memories.length : 0,
  }

  if (blocks.length === 0) return { text: '', trace }
  const body = blocks.join('\n\n')
  const text = body.length > MAX_RUNTIME_CHARS
    ? `${body.slice(0, MAX_RUNTIME_CHARS - 1)}…`
    : body
  return {
    text: `<persona-moment name="${escapeAttribute(persona.name)}">\n${text}\n</persona-moment>`,
    trace,
  }
}

export function compileCapsule(persona, state, query, current = Date.now()) {
  const card = compileCard(persona)
  const runtime = compileRuntime(persona, state, query, current).text
  return [card, runtime].filter(Boolean).join('\n\n')
}

/** 给模型 / 斜杠命令看的完整卡片文本。 */
export function showPersonaText(persona, state) {
  const lines = [
    `id: ${persona.id}`,
    `name: ${persona.name}`,
    `revision: ${persona.revision}`,
    `summary: ${persona.summary || '(empty)'}`,
    `tags: ${(persona.tags || []).join(', ') || '(none)'}`,
    `maxReplyChars: ${Number(persona.maxReplyChars) || 0}`,
    `masterName: ${masterNameOf(persona) || MASTER_NAME_DEFAULT}`,
    `injectLore: ${persona.injectLore !== false}`,
    `injectTags: ${persona.injectTags !== false}`,
    `useActions: ${persona.useActions === true}`,
    `useMemes: ${persona.useMemes === true} (frequency ${Number.isFinite(Number(persona.memeFrequency)) ? Math.round(Number(persona.memeFrequency)) : MEME_FREQUENCY_DEFAULT}%)`,
    `autoMemory: ${persona.autoMemory === true}`,
    '',
    `tagCode:\n${persona.tagCode || deriveTagCode(persona) || '(auto: 卡片内容太少，没有可生成的锚点)'}`,
    '',
    `identity:\n${persona.identity || '(empty)'}`,
    '',
    `traits:\n${persona.traits || '(empty)'}`,
    '',
    `voice:\n${persona.voice || '(empty)'}`,
    '',
    `likes:\n${persona.likes || '(empty)'}`,
    '',
    `dislikes:\n${persona.dislikes || '(empty)'}`,
    '',
    `habits:\n${persona.habits || '(empty)'}`,
    '',
    `drives:\n${persona.drives || '(empty)'}`,
    '',
    `relationship:\n${persona.relationship || '(empty)'}`,
    '',
    `relationshipOthers:\n${persona.relationshipOthers || '(empty)'}`,
    '',
    `boundaries:\n${persona.boundaries || '(empty)'}`,
    '',
    `knowledge:\n${persona.knowledge || '(empty)'}`,
    '',
    `examples:\n${persona.examples || '(empty)'}`,
    '',
    `lore:\n${persona.lore || '(empty)'}`,
  ]
  if (state !== undefined) {
    lines.push('', '--- session state ---', `scene: ${state.scene || '(empty)'}`, `mood: ${state.mood || '(empty)'}`)
    if (state.relationship) lines.push(`relationship-now: ${state.relationship}`)
    const notes = Array.isArray(state.notes) ? state.notes : []
    lines.push(`notes (${notes.length}):`)
    for (const note of notes) {
      const when = formatNoteTime(note?.at)
      lines.push(`- [${noteId(note, 0)}] ${when === '' ? '' : `${when} `}${note?.pinned === true ? '📌 ' : ''}${clean(note?.text, MAX_NOTE_CHARS)}`)
    }
  }
  return lines.join('\n').slice(0, 20000)
}
