/**
 * 会话正史（canon notes）：只在这个会话里有效的小事。
 * 长期记忆（跨会话、跟卡走）在 memory.js。
 */

import { randomUUID } from 'node:crypto'
import { MAX_NOTE_CHARS, MAX_NOTE_ITEMS, MAX_NOTES, MAX_RUNTIME_CHARS, STOP_TOKENS } from './constants.js'
import { clean, formatNoteTime, now } from './util.js'

export function stateKey(sessionId, personaId) {
  return `${sessionId}::${personaId}`
}

export function emptyState(sessionId, personaId) {
  return {
    sessionId,
    personaId,
    scene: '',
    mood: '',
    relationship: '',
    notes: [],
    createdAt: now(),
    updatedAt: now(),
  }
}

export function normalizeNote(raw, index = 0, current = now()) {
  if (raw === null || typeof raw !== 'object') return null
  const text = clean(raw.text, MAX_NOTE_CHARS)
  if (text === '') return null
  const at = Number.isFinite(raw.at) && raw.at > 0 ? raw.at : current
  const id = typeof raw.id === 'string' && raw.id !== ''
    ? raw.id
    : `n_${at.toString(36)}_${index}`
  return { id, text, at, pinned: raw.pinned === true }
}

export function normalizeNotes(rawNotes, current = now()) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(rawNotes) ? rawNotes : []) {
    const note = normalizeNote(raw, out.length, current)
    if (note === null || seen.has(note.text)) continue
    seen.add(note.text)
    out.push(note)
    if (out.length >= MAX_NOTES) break
  }
  return out
}

export function newNote(text, pinned) {
  return {
    id: `n_${randomUUID()}`,
    text,
    at: now(),
    pinned: pinned === true,
  }
}

export function noteId(note, index) {
  if (typeof note?.id === 'string' && note.id !== '') return note.id
  return `n_${Number(note?.at) || 0}_${index}`
}

/** 中文双字 + 英文词的粗分词，够用来判断「这条正史说的是这件事」。 */
export function tokensOf(text) {
  const out = new Set()
  const source = String(text ?? '').toLowerCase()
  for (const match of source.matchAll(/[a-z0-9_]{2,}/g)) out.add(match[0])
  for (const match of source.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const segment = match[0]
    for (let i = 0; i < segment.length - 1; i++) out.add(segment.slice(i, i + 2))
  }
  for (const token of out) if (STOP_TOKENS.has(token)) out.delete(token)
  return out
}

export function scoreNotes(notes, query, current = Date.now()) {
  const queryTokens = tokensOf(query)
  return notes.map((note, index) => {
    const text = clean(note?.text, MAX_NOTE_CHARS)
    const at = Number(note?.at) || 0
    const ageDays = at > 0 ? Math.max(0, (current - at) / 86400000) : 3650
    const recency = Math.exp(-ageDays / 21)
    let hits = 0
    if (queryTokens.size > 0) {
      for (const token of tokensOf(text)) if (queryTokens.has(token)) hits += 1
    }
    return {
      id: noteId(note, index),
      text,
      at,
      pinned: note?.pinned === true,
      score: hits * 4 + recency * 3 + (note?.pinned === true ? 100 : 0),
      hits,
    }
  })
}

/**
 * 挑出这一轮值得进上下文的正史：固定的永远最前，其余按与最近一句用户消息的
 * 相关性、再按新鲜度排。超出预算的记进 trace，不静默丢弃。
 */
export function selectNotes(state, query, current = Date.now()) {
  const notes = Array.isArray(state?.notes) ? state.notes : []
  const scored = scoreNotes(notes, query, current)
  const pinned = scored.filter((note) => note.pinned).sort((a, b) => b.at - a.at).slice(0, 6)
  const rest = scored.filter((note) => !note.pinned).sort((a, b) => b.score - a.score || b.at - a.at)
  const ordered = [...pinned, ...rest]
  const picked = []
  const omitted = []
  let used = 0
  for (const note of ordered) {
    const when = formatNoteTime(note.at, current)
    const line = when === '' ? note.text : `${when}：${note.text}`
    const cost = line.length + 3
    if (note.text === '') continue
    if (picked.length >= MAX_NOTE_ITEMS) {
      omitted.push({ id: note.id, reason: 'limit' })
      continue
    }
    if (used + cost > MAX_RUNTIME_CHARS - 260) {
      omitted.push({ id: note.id, reason: 'budget' })
      continue
    }
    picked.push({ id: note.id, line, reason: note.pinned ? 'pinned' : note.hits > 0 ? 'relevance' : 'recent', hits: note.hits })
    used += cost
  }
  return { picked, omitted, chars: used }
}
