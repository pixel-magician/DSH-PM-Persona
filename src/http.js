/**
 * 前端唯一通道：POST /pm-persona/api
 *
 * 所有 op 都是纯数据操作；同源校验挡住跨站请求。
 * 新增 UI 功能时：这里加一个 op 分支，client.js 里加一个 api('op') 调用。
 */

import { MAX_BODY_BYTES, ROUTE_PATH } from './constants.js'
import { errorText } from './util.js'
import { memoryClarity } from './memory.js'
import { enrichPersona, digestMemories } from './enrich.js'

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大。'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${errorText(error)}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 把 store 上能暴露给前端的记忆字段整理一遍。 */
function memoryView(record) {
  return {
    id: record.id,
    text: record.text,
    kind: record.kind,
    importance: record.importance,
    pinned: record.pinned,
    firstMet: record.firstMet,
    owner: record.owner,
    mergedCount: record.mergedCount,
    createdAt: record.createdAt,
    clarity: memoryClarity(record),
  }
}

export function createApiHandler(ctx, store) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '只接受 POST。' })
      return
    }
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      try {
        if (new URL(origin).origin !== new URL(ctx.webServer.getOrigin()).origin) {
          sendJson(res, 403, { ok: false, error: '拒绝跨源请求。' })
          return
        }
      } catch {
        sendJson(res, 403, { ok: false, error: '拒绝无法识别的来源。' })
        return
      }
    }
    try {
      const body = await readJsonBody(req)
      const op = String(body.op ?? '')
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''

      if (op === 'snapshot') {
        sendJson(res, 200, {
          ok: true,
          personas: store.listPersonas(body.includeArchived === true),
          active: sessionId === '' ? null : store.activeSnapshot(sessionId),
        })
        return
      }
      if (op === 'get') {
        const persona = store.requirePersona(body.id)
        sendJson(res, 200, { ok: true, persona })
        return
      }
      if (op === 'memory-list') {
        const persona = store.requirePersona(body.id)
        sendJson(res, 200, {
          ok: true,
          memories: store.listMemories(persona.id).map(memoryView),
        })
        return
      }
      if (op === 'memory-add') {
        const persona = store.requirePersona(body.id)
        const { record, count } = await store.rememberLong(persona.id, {
          text: body.text,
          kind: body.kind,
          importance: body.importance,
          pinned: body.pinned === true,
        }, sessionId)
        sendJson(res, 200, { ok: true, memory: memoryView(record), count })
        return
      }
      if (op === 'memory-backups') {
        const persona = store.requirePersona(body.id)
        sendJson(res, 200, { ok: true, backups: store.listMemoryBackups(persona.id) })
        return
      }
      if (op === 'memory-restore') {
        const persona = store.requirePersona(body.id)
        const result = await store.restoreMemoryBackup(persona.id, body.day)
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      if (op === 'memory-prune') {
        const persona = store.requirePersona(body.id)
        const below = Number.isFinite(Number(body.below)) ? Math.max(0, Math.min(1, Number(body.below))) : 0.15
        const result = await store.pruneMemories(persona.id, below)
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      if (op === 'memory-forget') {
        const persona = store.requirePersona(body.id)
        const { removed, count } = await store.forgetLong(persona.id, body.memoryId)
        sendJson(res, 200, { ok: true, removed: { id: removed.id, text: removed.text }, count })
        return
      }
      if (op === 'memory-pin') {
        const persona = store.requirePersona(body.id)
        const { record, count } = await store.setMemoryPinned(persona.id, body.memoryId, body.pinned !== false)
        sendJson(res, 200, { ok: true, pinned: record.pinned, count })
        return
      }
      if (op === 'preview') {
        const preview = store.preview(body.id, sessionId)
        sendJson(res, 200, { ok: true, ...preview })
        return
      }
      if (op === 'create') {
        const persona = await store.createPersona(body.persona ?? body)
        if (sessionId !== '') await store.usePersona(sessionId, persona.id)
        sendJson(res, 200, { ok: true, persona, active: sessionId === '' ? null : store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'update') {
        const persona = await store.updatePersona(body.id, body.patch ?? {})
        sendJson(res, 200, { ok: true, persona, active: sessionId === '' ? null : store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'delete') {
        const persona = await store.deletePersona(body.id)
        sendJson(res, 200, { ok: true, deleted: { id: persona.id, name: persona.name } })
        return
      }
      if (op === 'use') {
        if (sessionId === '') throw new Error('use 需要 sessionId。')
        const { persona } = await store.usePersona(sessionId, body.id)
        sendJson(res, 200, { ok: true, persona, active: store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'off') {
        if (sessionId === '') throw new Error('off 需要 sessionId。')
        await store.off(sessionId)
        sendJson(res, 200, { ok: true, active: null })
        return
      }
      if (op === 'state') {
        if (sessionId === '') throw new Error('state 需要 sessionId。')
        await store.updateState(sessionId, body.patch ?? {})
        sendJson(res, 200, { ok: true, active: store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'remember') {
        if (sessionId === '') throw new Error('remember 需要 sessionId。')
        const { state, note } = await store.remember(sessionId, body.text, { pinned: body.pinned === true })
        sendJson(res, 200, { ok: true, state, note, active: store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'notes') {
        if (sessionId === '') throw new Error('notes 需要 sessionId。')
        const active = store.requireActive(sessionId)
        sendJson(res, 200, { ok: true, state: store.getState(sessionId, active.persona.id) })
        return
      }
      if (op === 'forget') {
        if (sessionId === '') throw new Error('forget 需要 sessionId。')
        const { state, removed } = await store.forget(sessionId, body.noteId)
        sendJson(res, 200, { ok: true, state, removed, active: store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'pin') {
        if (sessionId === '') throw new Error('pin 需要 sessionId。')
        const { state, note } = await store.setNotePinned(sessionId, body.noteId, body.pinned !== false)
        sendJson(res, 200, { ok: true, state, note, active: store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'memory-digest') {
        const persona = store.requirePersona(body.id)
        const result = await digestMemories(ctx, store, undefined, persona.id, sessionId)
        sendJson(res, 200, { ok: true, added: result.added.length })
        return
      }
      if (op === 'enrich') {
        const persona = store.requirePersona(body.id)
        const result = await enrichPersona(ctx, store, undefined, persona.id, body.overwrite === true)
        sendJson(res, 200, {
          ok: true,
          changed: result.changed,
          filled: result.filled,
          persona: result.persona,
        })
        return
      }
      if (op === 'clear') {
        if (sessionId === '') throw new Error('clear 需要 sessionId。')
        const cleared = await store.clearState(sessionId)
        sendJson(res, 200, { ok: true, state: cleared, active: store.activeSnapshot(sessionId) })
        return
      }
      if (op === 'trace') {
        if (sessionId === '') throw new Error('trace 需要 sessionId。')
        sendJson(res, 200, { ok: true, trace: store.traces.get(sessionId) ?? null })
        return
      }
      if (op === 'export') {
        sendJson(res, 200, { ok: true, data: store.exportData() })
        return
      }
      if (op === 'import') {
        const result = await store.importData(body.data, body.mode === 'replace' ? 'replace' : 'merge')
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      throw new Error(`不支持的 op：${op}`)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  }
}

export const API_PATH = ROUTE_PATH
