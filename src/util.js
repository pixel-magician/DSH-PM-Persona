/**
 * 到处都会用到的小工具：清洗、转义、时间格式化、JSON 安全化。
 */

export const now = () => Date.now()

/** 去空白、截断、去掉 JSON 能带但提示词不该带的 \u0000。 */
export function clean(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/\u0000/g, '').trim().slice(0, max)
}

export function cleanTags(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const tag = clean(raw, 32)
    if (tag === '' || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(tag)
    if (out.length >= 12) break
  }
  return out
}

export function clampInt(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

/**
 * 工具结果必须能被 JSON 原样带回去：值为 undefined 的键会让 Harness
 * 判定「不是无损 JSON」而拒绝整个结果，所以直接丢掉这些键。
 */
export function jsonSafe(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (
      item === undefined || (typeof item === 'number' && !Number.isFinite(item)) ? null : jsonSafe(item)
    ))
  }
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      if (typeof item === 'number' && !Number.isFinite(item)) continue
      out[key] = jsonSafe(item)
    }
    return out
  }
  return value
}

export function escapeAttribute(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 防止卡片正文里的 `</persona>` 提前把容器闭合。 */
export function escapePersonaBody(text) {
  return String(text).replace(/<\/(persona(?:-moment)?)/gi, '<\\/$1')
}

export function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 消息正文：字符串或 content 数组。 */
export function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text')
      .map((part) => String(part?.text ?? ''))
      .join('\n')
  }
  return ''
}

/** 「今天 09:30」「昨天 22:10」「3 天前」这样的相对时间。 */
export function formatNoteTime(at, current = Date.now()) {
  const value = Number(at)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const today = new Date(current)
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(date)) / 86400000)
  const pad = (n) => String(n).padStart(2, '0')
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (days === 0) return `今天 ${hhmm}`
  if (days === 1) return `昨天 ${hhmm}`
  if (days > 1 && days <= 7) return `${days} 天前`
  const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (date.getFullYear() === today.getFullYear()) return `${md}（${days} 天前）`
  return `${date.getFullYear()}-${md}`
}

/** 会话里最后一条对话消息的时间（user 或 assistant）。没有就 0。 */
export function lastMessageAt(session) {
  if (session === null || session === undefined || typeof session.deriveMessages !== 'function') return 0
  try {
    const messages = session.deriveMessages()
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const role = messages[i]?.role
      if (role !== 'user' && role !== 'assistant') continue
      const at = Number(messages[i]?.time ?? messages[i]?.createdAt ?? 0)
      if (Number.isFinite(at) && at > 0) return at
    }
  } catch {
    return 0
  }
  return 0
}
