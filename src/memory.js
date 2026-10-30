/**
 * 长期记忆：跟着人格卡走、跨会话累积，会淡不会删。
 *
 * 一条记忆 = 文本 + 类型 + 重要度 + 主人标记 + 分人（owner）。
 * 鲜活度 clarity 按 0.5^(ageDays / 半衰期) 衰减，半衰期 7~67 天；
 * 置顶和「初遇」恒为 100%。重复的会合并，不会越堆越多。
 */

import { randomUUID } from 'node:crypto'
import {
  AUTO_MEMORY_MAX_PER_HARVEST,
  AUTO_MEMORY_PATTERNS,
  MAX_MEMORIES,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_ITEMS,
  MAX_PATTERN_MEMORIES,
  MEMORY_IMPORTANCE_DEFAULT,
  MEMORY_KINDS,
} from './constants.js'
import { clampInt, clean, formatNoteTime } from './util.js'

export function mineMemories(text) {
  const body = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (body.length < 5) return []
  // 问句和假设不记：那不是事实陈述。
  if (/[？?]\s*$/.test(body)) return []
  if (/^(如果|要是|假如|假设)/.test(body)) return []
  const out = []
  for (const { kind, pattern } of AUTO_MEMORY_PATTERNS) {
    const match = pattern.exec(body)
    if (match === null) continue
    const snippet = match[0].trim()
    if (snippet.length < 4 || snippet.length > 40) continue
    if (/(什么|啥|哪|谁|吗|呢|怎么|多少|几)$/.test(snippet)) continue
    // 代码/符号混排的不算口语陈述（正则片段、路径、URL 都在这被挡掉）。
    if (/[\/|`*()\[\]{}<>#=_]/.test(snippet)) continue
    if (out.some((item) => item.text === snippet)) continue
    out.push({ kind, text: snippet })
  }
  return out
}

export function normalizeMemoryRecord(raw, current = Date.now()) {
  const record = raw !== null && typeof raw === 'object' ? raw : {}
  const text = clean(record.text, 400)
  if (text === '') return null
  return {
    id: typeof record.id === 'string' && record.id !== '' ? record.id : `m_${randomUUID()}`,
    text,
    kind: MEMORY_KINDS.includes(record.kind) ? record.kind : 'fact',
    importance: clampInt(record.importance, MEMORY_IMPORTANCE_DEFAULT, 0, 5),
    pinned: record.pinned === true,
    firstMet: record.firstMet === true,
    owner: typeof record.owner === 'string' ? record.owner.slice(0, 40) : '',
    mergedCount: clampInt(record.mergedCount, 1, 1, 999),
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag) => typeof tag === 'string' && tag !== '').slice(0, 6)
      : [],
    createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : current,
    lastSeenAt: Number.isFinite(Number(record.lastSeenAt)) ? Number(record.lastSeenAt) : current,
    source: typeof record.source === 'string' ? record.source.slice(0, 120) : '',
  }
}

/** 鲜活度：置顶 / 初次相遇恒为 1；其余按重要度给半衰期，只会淡不会被删。 */
export function memoryClarity(record, current = Date.now()) {
  if (record?.pinned === true || record?.firstMet === true) return 1
  const importance = clampInt(record?.importance, MEMORY_IMPORTANCE_DEFAULT, 0, 5)
  const halfLifeDays = 7 + importance * 12
  const ageDays = Math.max(0, (current - Number(record?.createdAt ?? current)) / 86_400_000)
  return Math.max(0, Math.min(1, Math.pow(0.5, ageDays / halfLifeDays)))
}

/** 中文双字片段的粗命中数：够用、便宜，不需要分词库。 */
export function queryHits(text, query) {
  const body = String(text ?? '')
  const subject = String(query ?? '').replace(/\s+/g, '').slice(0, 80)
  if (body === '' || subject === '') return 0
  let hits = 0
  for (let i = 0; i + 1 < subject.length; i += 1) {
    if (body.includes(subject.slice(i, i + 2))) hits += 1
  }
  return hits
}

export function memoryScore(record, query, current = Date.now(), owner = '') {
  const clarity = memoryClarity(record, current)
  const importance = clampInt(record?.importance, MEMORY_IMPORTANCE_DEFAULT, 0, 5) / 5
  const hits = queryHits(record?.text, query)
  const sameOwner = owner !== '' && record?.owner === owner ? 0.15 : 0
  return { score: importance * 0.55 + clarity * 0.35 + Math.min(0.4, hits * 0.2) + sameOwner, clarity, hits }
}

function memoryTokens(text) {
  const body = String(text ?? '').toLowerCase().replace(/[\s\p{P}]+/gu, '')
  const set = new Set()
  for (let i = 0; i + 1 < body.length; i += 1) set.add(body.slice(i, i + 2))
  return set
}

/** 中文双字 Jaccard：两条记忆像不像。 */
export function memorySimilarity(a, b) {
  const left = memoryTokens(a)
  const right = memoryTokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

/**
 * 压缩合并：同 kind、同 owner、文本够像的两条并成一条。
 * 保留信息更全的那句，重要度取高、置顶/初遇取或、时间取交集，mergedCount 累加。
 */
export function mergeDuplicateMemories(records, threshold = 0.62) {
  const out = []
  for (const record of Array.isArray(records) ? records : []) {
    const existing = out.find((item) =>
      item.kind === record.kind
      && item.owner === record.owner
      && memorySimilarity(item.text, record.text) >= threshold
    )
    if (existing === undefined) {
      out.push({ ...record })
      continue
    }
    const keepNewText = record.text.length > existing.text.length
    const keepNewId = record.importance > existing.importance
      || (record.importance === existing.importance && record.createdAt > existing.createdAt)
    out[out.indexOf(existing)] = {
      ...existing,
      id: keepNewId ? record.id : existing.id,
      text: keepNewText ? record.text : existing.text,
      importance: Math.max(existing.importance, record.importance),
      pinned: existing.pinned || record.pinned,
      firstMet: existing.firstMet || record.firstMet,
      tags: [...new Set([...(existing.tags ?? []), ...(record.tags ?? [])])].slice(0, 6),
      createdAt: Math.min(existing.createdAt, record.createdAt),
      lastSeenAt: Math.max(existing.lastSeenAt, record.lastSeenAt),
      mergedCount: (existing.mergedCount ?? 1) + (record.mergedCount ?? 1),
    }
  }
  return out
}

/** 超出上限时按「置顶 / 初遇优先 → 综合分」淘汰。 */
export function trimMemories(records, current = Date.now()) {
  let list = Array.isArray(records) ? records : []
  // pattern 是归纳出来的结论，单独限量：不限的话它会一头挤掉具体事实。
  const patterns = list.filter((record) => record.kind === 'pattern')
  if (patterns.length > MAX_PATTERN_MEMORIES) {
    const kept = patterns
      .map((record) => ({ record, score: memoryScore(record, '', current).score }))
      .sort((a, b) => {
        const pinA = a.record.pinned === true || a.record.firstMet === true ? 1 : 0
        const pinB = b.record.pinned === true || b.record.firstMet === true ? 1 : 0
        if (pinA !== pinB) return pinB - pinA
        return b.score - a.score
      })
      .slice(0, MAX_PATTERN_MEMORIES)
      .map((item) => item.record)
    const keepIds = new Set(kept.map((record) => record.id))
    list = list.filter((record) => record.kind !== 'pattern' || keepIds.has(record.id))
  }
  if (list.length <= MAX_MEMORIES) return list
  const scored = list.map((record) => ({ record, score: memoryScore(record, '', current).score }))
  scored.sort((a, b) => {
    const keepA = a.record.pinned === true || a.record.firstMet === true ? 1 : 0
    const keepB = b.record.pinned === true || b.record.firstMet === true ? 1 : 0
    if (keepA !== keepB) return keepB - keepA
    return b.score - a.score
  })
  return scored.slice(0, MAX_MEMORIES).map((item) => item.record)
}

/** 每轮挑进 [Long-term memories] 的那几条。 */
export function selectMemories(records, query, current = Date.now(), options = {}) {
  const maxItems = options.maxItems ?? MAX_MEMORY_ITEMS
  const budget = options.budget ?? MAX_MEMORY_CHARS
  const owner = typeof options.owner === 'string' ? options.owner : ''
  const list = (Array.isArray(records) ? records : [])
    .map((record) => normalizeMemoryRecord(record, current))
    .filter((record) => record !== null)
    .map((record) => ({ record, ...memoryScore(record, query, current, owner) }))
  list.sort((a, b) => {
    const firstA = a.record.firstMet === true ? 1 : 0
    const firstB = b.record.firstMet === true ? 1 : 0
    if (firstA !== firstB) return firstB - firstA
    const pinA = a.record.pinned === true ? 1 : 0
    const pinB = b.record.pinned === true ? 1 : 0
    if (pinA !== pinB) return pinB - pinA
    return b.score - a.score || b.record.lastSeenAt - a.record.lastSeenAt
  })
  const picked = []
  let used = 0
  for (const item of list) {
    if (picked.length >= maxItems) break
    const when = formatNoteTime(item.record.createdAt, current)
    // 重复次数要露出来：模型得先知道「这事已经第 4 次了」，才可能归纳出规律。
    const repeat = Number(item.record.mergedCount) > 1
      ? `（已提到 ${Math.min(99, Number(item.record.mergedCount))} 次）`
      : ''
    const body = `${item.record.text}${repeat}`
    const line = when === '' ? body : `${when}：${body}`
    const cost = line.length + 3
    if (used + cost > budget) continue
    picked.push({ id: item.record.id, line, clarity: item.clarity, hits: item.hits })
    used += cost
  }
  return { picked, chars: used, total: list.length }
}

/** 自动记忆：从素材里捞稳定事实，去重后按低权重写进长期记忆。 */
export function harvestCandidates(materials, existing, owner, at = Date.now()) {
  const fresh = []
  for (const item of Array.isArray(materials) ? materials : []) {
    if (fresh.length >= AUTO_MEMORY_MAX_PER_HARVEST) break
    // 只从对方说的话里挖：「我」说的是他自己，不是我的输出。
    if (item.role !== 'user') continue
    for (const hit of mineMemories(item.text)) {
      if (fresh.length >= AUTO_MEMORY_MAX_PER_HARVEST) break
      const duplicate = existing.some((kept) => memorySimilarity(kept.text, hit.text) > 0.62)
        || fresh.some((kept) => memorySimilarity(kept.text, hit.text) > 0.62)
      if (duplicate) continue
      fresh.push({
        id: `m_${randomUUID()}`,
        text: hit.text,
        kind: hit.kind,
        importance: 2,
        pinned: false,
        firstMet: false,
        owner: typeof owner === 'string' ? owner : '',
        mergedCount: 1,
        tags: [],
        createdAt: at,
        lastSeenAt: at,
        source: 'auto',
      })
    }
  }
  return fresh
}
