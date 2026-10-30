/**
 * PersonaStore：四张表 + 会话绑定 + 正史 + 长期记忆。
 *
 * 存储由宿主注入（ctx.storageDomain），本模块不碰文件系统。
 */

import { randomUUID } from 'node:crypto'
import {
  FIELD_LIMITS,
  MAX_CARD_CHARS,
  MAX_MEMORY_BACKUPS,
  MAX_NOTES,
  MAX_NOTE_CHARS,
  MAX_RUNTIME_CHARS,
  MEMORY_HARVEST_MS,
} from './constants.js'
import { clean, lastMessageAt, messageText, now } from './util.js'
import { compileCard, normalizePersona, summaryOf } from './card.js'
import { emptyState, newNote, normalizeNotes, stateKey } from './notes.js'
import {
  harvestCandidates,
  memoryClarity,
  mergeDuplicateMemories,
  normalizeMemoryRecord,
  selectMemories,
  trimMemories,
} from './memory.js'
import { compileRuntime, showPersonaText } from './runtime.js'

/** 本地日期键：备份按天去重。 */
function localDayKey(at) {
  const date = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 从 QQ bridge 的消息前缀里认人：`… (QQ 591396639) …`。认不出来就空。 */
export function ownerOfSession(session) {
  if (session === null || session === undefined || typeof session.deriveMessages !== 'function') return ''
  try {
    const messages = session.deriveMessages()
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role !== 'user') continue
      const match = /\(QQ\s*(\d{5,12})\)/.exec(messageText(messages[i]))
      return match === null ? '' : `qq:${match[1]}`
    }
  } catch {
    return ''
  }
  return ''
}

export class PersonaStore {
  constructor(ctx, domain) {
    this.ctx = ctx
    this.personas = domain.table('personas')
    this.bindings = domain.table('bindings')
    this.states = domain.table('states')
    this.memories = domain.table('memories')
    this.traces = new Map()
    this.queryCache = new Map()
    this.harvestAt = new Map()
  }

  listPersonas(includeArchived = false) {
    const out = []
    for (const [, persona] of this.personas.entries()) {
      if (persona === null || typeof persona !== 'object') continue
      if (includeArchived !== true && persona.archived === true) continue
      out.push(summaryOf(persona))
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
    return out
  }

  getPersona(id) {
    if (typeof id !== 'string' || id === '') return undefined
    const persona = this.personas.get(id)
    return persona !== null && typeof persona === 'object' ? persona : undefined
  }

  resolvePersona(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') return undefined
    const direct = this.getPersona(ref.trim())
    if (direct !== undefined) return direct
    const needle = ref.trim().toLowerCase()
    const matches = []
    for (const [, persona] of this.personas.entries()) {
      if (persona === null || typeof persona !== 'object') continue
      if (String(persona.name ?? '').trim().toLowerCase() === needle) matches.push(persona)
    }
    if (matches.length > 1) throw new Error(`有多个人格同名「${ref}」，请改用 id。`)
    return matches[0]
  }

  requirePersona(ref) {
    const persona = this.resolvePersona(ref)
    if (persona === undefined) throw new Error(`找不到人格「${ref}」。`)
    return persona
  }

  async createPersona(input) {
    const name = clean(input?.name, FIELD_LIMITS.name)
    if (name === '') throw new Error('新建人格需要一个非空的名字。')
    const persona = normalizePersona({ ...input, name }, undefined)
    await this.personas.put(persona.id, persona)
    return persona
  }

  async updatePersona(id, patch) {
    const current = this.getPersona(id)
    if (current === undefined) throw new Error(`找不到人格「${id}」。`)
    const next = normalizePersona({ ...current, ...(patch ?? {}) }, current)
    await this.personas.put(current.id, next)
    return next
  }

  async deletePersona(id) {
    const current = this.getPersona(id)
    if (current === undefined) throw new Error(`找不到人格「${id}」。`)
    await this.personas.delete(current.id)
    for (const [sessionId, binding] of [...this.bindings.entries()]) {
      if (binding?.personaId === current.id) await this.bindings.delete(sessionId)
    }
    for (const key of [...this.states.keys()]) {
      if (key.endsWith(`::${current.id}`)) await this.states.delete(key)
    }
    return current
  }

  getBinding(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const binding = this.bindings.get(sessionId)
    if (binding === null || typeof binding !== 'object') return undefined
    if (typeof binding.personaId !== 'string' || binding.personaId === '') return undefined
    return binding
  }

  active(sessionId) {
    const binding = this.getBinding(sessionId)
    if (binding === undefined) return null
    const persona = this.getPersona(binding.personaId)
    if (persona === undefined || persona.archived === true) return null
    return { binding, persona }
  }

  requireActive(sessionId) {
    const active = this.active(sessionId)
    if (active === null) throw new Error('当前会话还没有绑定人格。请先创建或选择一个人格。')
    return active
  }

  getState(sessionId, personaId) {
    const stored = this.states.get(stateKey(sessionId, personaId))
    if (stored === null || typeof stored !== 'object') return emptyState(sessionId, personaId)
    return {
      ...emptyState(sessionId, personaId),
      ...stored,
      sessionId,
      personaId,
      notes: normalizeNotes(stored.notes),
    }
  }

  async putState(sessionId, personaId, state) {
    const next = {
      ...emptyState(sessionId, personaId),
      ...state,
      sessionId,
      personaId,
      notes: normalizeNotes(state?.notes).slice(0, MAX_NOTES),
      updatedAt: now(),
    }
    await this.states.put(stateKey(sessionId, personaId), next)
    return next
  }

  /** 找到这张卡最近有对话的会话。人格页是一级页面、没有 sessionId，归纳记忆时用它兜底。 */
  latestSessionForPersona(personaId) {
    const target = String(personaId ?? '')
    if (target === '') return ''
    let best = ''
    let bestAt = -1
    let ids = []
    try {
      ids = [...this.bindings.keys()]
    } catch {
      return ''
    }
    for (const sessionId of ids) {
      const binding = this.getBinding(sessionId)
      if (binding === undefined || binding.personaId !== target) continue
      const at = lastMessageAt(this.session(sessionId))
      if (at > bestAt) {
        bestAt = at
        best = String(sessionId)
      }
    }
    return best
  }

  /** 长期记忆：per-persona，跨会话累积，跟会话正史分开放。 */
  listMemories(personaId) {
    const stored = this.memories.get(String(personaId))
    const records = Array.isArray(stored?.records) ? stored.records : []
    return records.map((record) => normalizeMemoryRecord(record)).filter((record) => record !== null)
  }

  async putMemories(personaId, records) {
    // 变更前先留一份当天快照：误删/误合并还能捞回来。
    await this.snapshotMemories(personaId).catch((error) => {
      this.ctx.logger?.warn?.('pm-persona: memory snapshot failed: %o', error)
    })
    const next = {
      personaId: String(personaId),
      records: trimMemories(mergeDuplicateMemories(records)),
      updatedAt: now(),
    }
    await this.memories.put(String(personaId), next)
    return next
  }

  async rememberLong(personaId, input = {}, source = '') {
    const records = this.listMemories(personaId)
    const record = normalizeMemoryRecord({
      text: input.text,
      kind: input.kind,
      importance: input.importance,
      pinned: input.pinned === true,
      firstMet: input.firstMet === true,
      owner: typeof input.owner === 'string' ? input.owner : '',
      tags: input.tags,
      source,
      createdAt: now(),
      lastSeenAt: now(),
    })
    if (record === null) throw new Error('要记的内容不能为空。')
    const kept = records.filter((item) => item.text !== record.text)
    kept.push(record)
    const next = await this.putMemories(personaId, kept)
    return { record, count: next.records.length }
  }

  async forgetLong(personaId, ref) {
    const records = this.listMemories(personaId)
    const key = String(ref ?? '').trim()
    if (key === '') throw new Error('要删哪条？给 id 或原文片段。')
    const index = records.findIndex((item) => item.id === key || item.text.includes(key))
    if (index === -1) throw new Error('没找到这条记忆。')
    const [removed] = records.splice(index, 1)
    const next = await this.putMemories(personaId, records)
    return { removed, count: next.records.length }
  }

  selectMemoriesFor(personaId, query, current = now(), owner = '') {
    return selectMemories(this.listMemories(personaId), query, current, { owner })
  }

  /** 自动记忆：从最近的对话里捞稳定事实；10 分钟一次的节流在调用方。 */
  async harvestMemories(personaId, materials, owner = '', at = now()) {
    const existing = this.listMemories(personaId)
    const fresh = harvestCandidates(materials, existing, owner, at)
    if (fresh.length === 0) return { added: 0, total: existing.length }
    const next = await this.putMemories(personaId, [...existing, ...fresh])
    return { added: fresh.length, total: next.records.length }
  }

  /** 每天一份快照，最多留 7 份。同一天已经存过就跳过。 */
  async snapshotMemories(personaId, at = now()) {
    const key = String(personaId)
    const day = localDayKey(at)
    const id = `${key}#backup#${day}`
    const existing = this.memories.get(id)
    if (existing !== null && existing !== undefined) return null
    const records = this.listMemories(key)
    if (records.length === 0) return null
    const entry = { personaId: key, day, at, records, kind: 'backup' }
    await this.memories.put(id, entry)
    let days = []
    try {
      days = [...this.memories.keys()].filter((item) => item.startsWith(`${key}#backup#`)).sort()
    } catch {
      days = []
    }
    for (const stale of days.slice(0, Math.max(0, days.length - MAX_MEMORY_BACKUPS))) {
      await this.memories.delete(stale)
    }
    return entry
  }

  listMemoryBackups(personaId) {
    const key = String(personaId)
    const prefix = `${key}#backup#`
    try {
      return [...this.memories.keys()]
        .filter((item) => item.startsWith(prefix))
        .map((item) => this.memories.get(item))
        .filter((entry) => entry !== null && entry !== undefined && typeof entry === 'object')
        .sort((a, b) => String(b.day).localeCompare(String(a.day)))
        .map((entry) => ({
          day: entry.day,
          at: entry.at,
          count: Array.isArray(entry.records) ? entry.records.length : 0,
        }))
    } catch {
      return []
    }
  }

  async restoreMemoryBackup(personaId, day) {
    const key = String(personaId)
    const entry = this.memories.get(`${key}#backup#${String(day ?? '')}`)
    if (entry === null || typeof entry !== 'object') throw new Error('没找到这一天的快照。')
    const records = Array.isArray(entry.records) ? entry.records : []
    const next = await this.putMemories(key, records)
    return { count: next.records.length, day: entry.day }
  }

  async setMemoryPinned(personaId, ref, pinned = true) {
    const records = this.listMemories(personaId)
    const key = String(ref ?? '').trim()
    if (key === '') throw new Error('要给哪条置顶？给 id 或原文片段。')
    const index = records.findIndex((item) => item.id === key || item.text.includes(key))
    if (index === -1) throw new Error('没找到这条记忆。')
    const record = { ...records[index], pinned: pinned === true, lastSeenAt: now() }
    records[index] = record
    const next = await this.putMemories(personaId, records)
    return { record, count: next.records.length }
  }

  /** 清掉鲜活度低于阈值的记忆（置顶和初遇不动）。 */
  async pruneMemories(personaId, below = 0.15) {
    const records = this.listMemories(personaId)
    const kept = records.filter((record) =>
      record.pinned === true || record.firstMet === true || memoryClarity(record) >= below
    )
    await this.putMemories(personaId, kept)
    return { removed: records.length - kept.length, count: kept.length }
  }

  async usePersona(sessionId, ref) {
    const persona = this.requirePersona(ref)
    if (persona.archived === true) throw new Error(`人格「${persona.name}」已归档，不能绑定。`)
    const binding = {
      sessionId,
      personaId: persona.id,
      createdAt: now(),
      updatedAt: now(),
    }
    await this.bindings.put(sessionId, binding)
    const existingState = this.states.get(stateKey(sessionId, persona.id))
    if (existingState === null || typeof existingState !== 'object') {
      await this.states.put(stateKey(sessionId, persona.id), emptyState(sessionId, persona.id))
    }
    return { binding, persona }
  }

  async off(sessionId) {
    await this.bindings.delete(sessionId)
  }

  async updateState(sessionId, patch) {
    const { persona } = this.requireActive(sessionId)
    const current = this.getState(sessionId, persona.id)
    const next = { ...current }
    if (patch?.scene !== undefined) next.scene = clean(patch.scene, 1000)
    if (patch?.mood !== undefined) next.mood = clean(patch.mood, 200)
    if (patch?.relationship !== undefined) next.relationship = clean(patch.relationship, 500)
    return this.putState(sessionId, persona.id, next)
  }

  async remember(sessionId, text, options = {}) {
    const { persona } = this.requireActive(sessionId)
    const body = clean(text, MAX_NOTE_CHARS)
    if (body === '') throw new Error('要记录的正史内容不能为空。')
    const current = this.getState(sessionId, persona.id)
    const pinned = options?.pinned === true
    const notes = current.notes.filter((note) => note.text !== body)
    const note = newNote(body, pinned)
    notes.unshift(note)
    const state = await this.putState(sessionId, persona.id, { ...current, notes: notes.slice(0, MAX_NOTES) })
    return { state, note }
  }

  async forget(sessionId, ref) {
    const { persona } = this.requireActive(sessionId)
    const needle = clean(ref, MAX_NOTE_CHARS)
    if (needle === '') throw new Error('要删除哪一条？请给 noteId 或原文片段。')
    const current = this.getState(sessionId, persona.id)
    let index = current.notes.findIndex((note) => note.id === needle)
    if (index < 0) index = current.notes.findIndex((note) => note.text.includes(needle))
    if (index < 0) throw new Error(`没有找到匹配「${needle}」的正史条目。`)
    const [removed] = current.notes.splice(index, 1)
    const state = await this.putState(sessionId, persona.id, { ...current, notes: current.notes })
    return { state, removed }
  }

  async setNotePinned(sessionId, ref, pinned) {
    const { persona } = this.requireActive(sessionId)
    const needle = clean(ref, MAX_NOTE_CHARS)
    if (needle === '') throw new Error('要固定哪一条？请给 noteId 或原文片段。')
    const current = this.getState(sessionId, persona.id)
    let index = current.notes.findIndex((note) => note.id === needle)
    if (index < 0) index = current.notes.findIndex((note) => note.text.includes(needle))
    if (index < 0) throw new Error(`没有找到匹配「${needle}」的正史条目。`)
    current.notes[index] = { ...current.notes[index], pinned: pinned === true }
    const state = await this.putState(sessionId, persona.id, { ...current, notes: current.notes })
    return { state, note: current.notes[index] }
  }

  async clearState(sessionId) {
    const { persona } = this.requireActive(sessionId)
    const cleared = emptyState(sessionId, persona.id)
    await this.states.put(stateKey(sessionId, persona.id), cleared)
    this.traces.delete(sessionId)
    return cleared
  }

  /** 最近一条用户消息，按 session.seq 缓存，装配才跑得便宜。 */
  lastUserText(session) {
    if (session === null || session === undefined || typeof session.id !== 'string') return ''
    try {
      const seq = typeof session.seq === 'number' ? session.seq : 0
      const hit = this.queryCache.get(session.id)
      if (hit !== undefined && hit.seq === seq) return hit.text
      let text = ''
      const messages = session.deriveMessages()
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
          text = messageText(messages[i]).slice(0, 2000)
          break
        }
      }
      if (this.queryCache.size > 200) this.queryCache.clear()
      this.queryCache.set(session.id, { seq, text })
      return text
    } catch {
      return ''
    }
  }

  session(sessionId) {
    try {
      return this.ctx.get('sessions')?.get(sessionId)
    } catch {
      return undefined
    }
  }

  cardForSession(sessionId) {
    const active = this.active(sessionId)
    if (active === null) return ''
    return compileCard(active.persona)
  }

  runtimeForSession(sessionId) {
    const active = this.active(sessionId)
    if (active === null) return ''
    const state = this.getState(sessionId, active.persona.id)
    const session = this.session(sessionId)
    const query = this.lastUserText(session)
    const owner = ownerOfSession(session)
    const memories = this.selectMemoriesFor(active.persona.id, query, Date.now(), owner).picked.map((item) => item.line)
    const runtime = compileRuntime(active.persona, state, query, Date.now(), memories)
    this.traces.set(sessionId, runtime.trace)
    return runtime.text
  }

  /** 自动记忆的入口：按会话节流，从最近消息里挖，返回新增条数。 */
  async harvestIfDue(sessionId, session, personaId) {
    const last = this.harvestAt.get(sessionId) ?? 0
    if (Date.now() - last < MEMORY_HARVEST_MS) return 0
    this.harvestAt.set(sessionId, Date.now())
    let materials = []
    try {
      const messages = session?.deriveMessages?.() ?? []
      materials = messages.slice(-8).map((message) => ({ role: message?.role, text: messageText(message) }))
    } catch {
      materials = []
    }
    if (materials.length === 0) return 0
    const result = await this.harvestMemories(personaId, materials, ownerOfSession(session))
    return result.added
  }

  activeSnapshot(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null
    const active = this.active(sessionId)
    if (active === null) return null
    const state = this.getState(sessionId, active.persona.id)
    const query = this.lastUserText(this.session(sessionId))
    const card = compileCard(active.persona)
    const runtime = compileRuntime(active.persona, state, query)
    this.traces.set(sessionId, runtime.trace)
    return {
      persona: active.persona,
      binding: active.binding,
      state,
      card,
      runtime: runtime.text,
      trace: runtime.trace,
      capsule: [card, runtime.text].filter(Boolean).join('\n\n'),
    }
  }

  compileForSession(sessionId) {
    const active = this.active(sessionId)
    if (active === null) return ''
    return [this.cardForSession(sessionId), this.runtimeForSession(sessionId)].filter(Boolean).join('\n\n')
  }

  preview(id, sessionId) {
    const persona = this.requirePersona(id)
    const state = typeof sessionId === 'string' && sessionId !== ''
      ? this.getState(sessionId, persona.id)
      : emptyState('', persona.id)
    const query = typeof sessionId === 'string' && sessionId !== ''
      ? this.lastUserText(this.session(sessionId))
      : ''
    const card = compileCard(persona)
    const runtime = compileRuntime(persona, state, query)
    return {
      card,
      runtime: runtime.text,
      capsule: [card, runtime.text].filter(Boolean).join('\n\n'),
      chars: card.length + runtime.text.length,
      budget: MAX_CARD_CHARS + MAX_RUNTIME_CHARS,
    }
  }

  exportData() {
    return {
      version: 1,
      exportedAt: now(),
      personas: [...this.personas.entries()].map(([, value]) => value),
      bindings: [...this.bindings.entries()].map(([, value]) => value),
      states: [...this.states.entries()].map(([, value]) => value),
    }
  }

  async importData(data, mode = 'merge') {
    if (data === null || typeof data !== 'object' || !Array.isArray(data.personas)) {
      throw new Error('导入文件缺少 personas 数组。')
    }
    if (mode === 'replace') {
      for (const id of [...this.personas.keys()]) await this.personas.delete(id)
      for (const id of [...this.bindings.keys()]) await this.bindings.delete(id)
      for (const key of [...this.states.keys()]) await this.states.delete(key)
    }
    let personaCount = 0
    for (const raw of data.personas) {
      if (raw === null || typeof raw !== 'object') continue
      const persona = normalizePersona(raw, undefined)
      if (typeof raw.id === 'string' && raw.id !== '') persona.id = raw.id
      if (Number.isFinite(raw.createdAt)) persona.createdAt = raw.createdAt
      if (Number.isFinite(raw.revision)) persona.revision = raw.revision
      await this.personas.put(persona.id, persona)
      personaCount += 1
    }
    let bindingCount = 0
    if (Array.isArray(data.bindings)) {
      for (const raw of data.bindings) {
        if (raw === null || typeof raw !== 'object') continue
        if (typeof raw.sessionId !== 'string' || typeof raw.personaId !== 'string') continue
        if (this.getPersona(raw.personaId) === undefined) continue
        await this.bindings.put(raw.sessionId, {
          sessionId: raw.sessionId,
          personaId: raw.personaId,
          createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now(),
          updatedAt: now(),
        })
        bindingCount += 1
      }
    }
    let stateCount = 0
    if (Array.isArray(data.states)) {
      for (const raw of data.states) {
        if (raw === null || typeof raw !== 'object') continue
        if (typeof raw.sessionId !== 'string' || typeof raw.personaId !== 'string') continue
        if (this.getPersona(raw.personaId) === undefined) continue
        await this.putState(raw.sessionId, raw.personaId, raw)
        stateCount += 1
      }
    }
    return { personas: personaCount, bindings: bindingCount, states: stateCount }
  }

  /** fork 出来的会话复制父会话的绑定、场景和正史。 */
  async inherit(session) {
    const parentId = session?.header?.parentSession
    if (typeof parentId !== 'string' || parentId === '') return
    if (session?.header?.origin === 'subagent') return
    if (this.getBinding(session.id) !== undefined) return
    const parent = this.active(parentId)
    if (parent === null) return
    await this.usePersona(session.id, parent.persona.id)
    const parentState = this.getState(parentId, parent.persona.id)
    await this.putState(session.id, parent.persona.id, {
      ...parentState,
      sessionId: session.id,
      notes: parentState.notes.map((note) => ({ ...note })),
    })
  }

  /** 斜杠命令 / 前端用：当前卡的完整文本。 */
  showTextFor(sessionId) {
    const active = this.requireActive(sessionId)
    return showPersonaText(active.persona, this.getState(sessionId, active.persona.id))
  }
}
