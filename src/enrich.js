/**
 * 调用模型的两件事：
 * - enrich：薄卡补完成可演的人格（只补空字段）；
 * - digest：把这段对话归纳成 1–3 条「规律」写进长期记忆。
 *
 * 都只在用户点击或模型主动调用时发生，不会每轮偷偷调。
 */

import { randomUUID } from 'node:crypto'
import {
  DIGEST_BANNED,
  DIGEST_MAX_CHARS,
  DIGEST_MAX_TURNS,
  DIGEST_MAX_WRITTEN,
  FIELD_LIMITS,
} from './constants.js'
import { clean, errorText, messageText } from './util.js'

const ENRICH_FIELDS = [
  'identity',
  'traits',
  'voice',
  'likes',
  'dislikes',
  'habits',
  'drives',
  'relationship',
  'relationshipOthers',
  'boundaries',
  'knowledge',
  'examples',
  'lore',
]

/** 当前会话用的模型：先问会话请求头，再退回默认模型。 */
function routeFor(ctx, agent) {
  try {
    const header = agent?.session?.requestHeader?.()
    const config = header?.config
    if (config?.provider && config?.model) return { provider: config.provider, model: config.model }
  } catch {}
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
  } catch {}
  return null
}

export async function askModel(ctx, agent, system, request, maxTokens) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('当前 Harness 没有可用的模型服务（ctx.llm），无法自动补完。')
  const route = routeFor(ctx, agent)
  if (route === null) throw new Error('拿不到当前会话使用的模型，无法自动补完。可先在设置里选一个模型，或在聊天里手动补字段。')
  const message = {
    id: `persona_${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text: request }],
    source: { kind: 'plugin', plugin: 'pm-persona' },
  }
  let text = ''
  try {
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [message],
      maxTokens: maxTokens ?? 1600,
      temperature: 0.4,
    })) {
      if (chunk?.type === 'text-delta') text += chunk.text
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        const failure = chunk.reason.failure ?? {}
        throw new Error(`模型报错：${failure.message ?? failure.code ?? '未知错误'}`)
      }
    }
  } catch (error) {
    throw new Error(`自动补完调用失败：${errorText(error)}`)
  }
  return { text: text.trim(), route }
}

function parseJsonObject(text, action) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`模型没有返回 JSON，${action}取消。`)
  let parsed
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  } catch {
    throw new Error(`模型返回的 JSON 无法解析，${action}取消。`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`模型返回的不是一个 JSON 对象，${action}取消。`)
  }
  return parsed
}

export async function enrichPersona(ctx, store, agent, ref, overwrite) {
  const persona = store.requirePersona(ref)
  const active = agent !== undefined && store.active(agent.id)?.persona?.id === persona.id
  const state = active ? store.getState(agent.id, persona.id) : { notes: [] }
  const known = {}
  for (const field of ENRICH_FIELDS) {
    if (typeof persona[field] === 'string' && persona[field].trim() !== '') {
      known[field] = clean(persona[field], field === 'lore' ? 1600 : 900)
    }
  }
  const notes = (state.notes ?? []).slice(0, 8).map((note) => `- ${clean(note.text, 240)}`)
  const system = [
    '你是一个角色设定编辑。你的任务是根据已有资料，补全一个角色的“自我认知”，让另一个模型能像她本人一样自然地说话、反应和回忆。',
    '只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。',
    'JSON 的键固定为：identity, traits, voice, likes, dislikes, habits, drives, relationship, relationshipOthers, boundaries, knowledge, examples, lore。',
    '每个值都是中文字符串。没有把握的字段给空字符串；不要编造会与已有资料冲突的事实。',
    '关系分成两类人写：relationship 写她对主人（选中、绑定这张卡的人）的态度——称呼、亲疏、依赖或顶撞的方式、愿意为他做到什么程度；relationshipOthers 写她对其他人（群友、陌生人、客人、围观者）的态度——礼貌、冷淡、戒备、敷衍还是逗弄，边界在哪。两者要形成明显反差，不要写成同一段话。',
    '要求：具体、可演、有细节。不要写“温柔善良”这类空泛形容词，要写她在具体情境里会怎么反应。',
    '除 examples 外，用第二人称“你”描述（lore 可以用第一人称“我”回忆）；不要写成第三方人物小传。',
    'traits 写性格与矛盾；likes/dislikes 写具体的人、物、活动；habits 写小动作和口头习惯；lore 写她自己的过去（第一人称经历）。',
    '每个字段控制在 1-4 句，总长度不超过 2500 字。',
  ].join('\n')
  const request = [
    `角色名：${persona.name}`,
    persona.summary ? `一句话设定：${persona.summary}` : '',
    (persona.tags ?? []).length > 0 ? `标签：${(persona.tags ?? []).join('、')}` : '',
    `已有资料（JSON）：\n${JSON.stringify(known, null, 2)}`,
    notes.length > 0 ? `她在这个会话里已经记得的事：\n${notes.join('\n')}` : '',
    overwrite
      ? '请在保留原意的前提下，把所有字段都重写得更完整、更具体。'
      : '请只补全现有资料里空着或明显太薄的字段；已有的内容保持原意，不要推翻。',
  ].filter(Boolean).join('\n\n')

  const { text, route } = await askModel(ctx, agent, system, request, 2600)
  const parsed = parseJsonObject(text, '补完')
  const patch = {}
  for (const field of ENRICH_FIELDS) {
    const value = clean(parsed[field], FIELD_LIMITS[field])
    if (value === '') continue
    if (overwrite !== true && typeof persona[field] === 'string' && persona[field].trim() !== '') continue
    patch[field] = value
  }
  const filled = Object.keys(patch)
  if (filled.length === 0) {
    return { persona, filled, route, changed: false }
  }
  const next = await store.updatePersona(persona.id, patch)
  if (active) await store.usePersona(agent.id, persona.id)
  return { persona: next, filled, route, changed: true }
}

/** 最近的对话素材：最多 N 条 user/assistant，截断到 600 字。 */
function collectMaterials(session, limit = DIGEST_MAX_TURNS) {
  if (session === null || session === undefined || typeof session.deriveMessages !== 'function') return []
  try {
    return session.deriveMessages()
      .slice(-limit)
      .filter((message) => message?.role === 'user' || message?.role === 'assistant')
      .map((message) => ({ role: message.role, text: messageText(message).slice(0, 600) }))
  } catch {
    return []
  }
}

export async function digestMemories(ctx, store, agent, personaId, sessionId) {
  const persona = store.requirePersona(personaId)
  // 人格页没有 sessionId：自动挑这张卡最近有对话的那个会话。
  const sid = typeof sessionId === 'string' && sessionId !== ''
    ? sessionId
    : store.latestSessionForPersona(persona.id)
  const session = sid === '' ? undefined : store.session(sid)
  const turns = collectMaterials(session)
  if (turns.length < 2) throw new Error('这张卡最近的会话里还没有足够的对话可以归纳，先聊几句再试。')
  const existing = store.listMemories(persona.id)

  const system = [
    '你只做一件事：从对话和已有记忆里提炼对方稳定的习惯与规律，输出 JSON。',
    '不写事件流水账，不评价人品，不编造对话里没出现过的事。',
  ].join('\n')

  const request = [
    `下面是「${persona.name}」和对方的最近对话，按时间顺序：`,
    ...turns.map((item) => `${item.role === 'user' ? '对方' : persona.name}：${item.text}`),
    '',
    existing.length === 0 ? '这个角色目前还没有长期记忆。' : '已有的长期记忆（不要重复写）：',
    ...existing.slice(0, 40).map((item) => `- [${item.kind}] ${item.text}`),
    '',
    '请归纳出 1–3 条关于对方的稳定习惯或规律，要求：',
    '- 只看对话里真出现过的行为模式，例如「常常熬夜，劝睡很少照做，顺着聊更有效」。',
    '- 一件事只写一条；没有足够证据就少写，甚至可以返回空数组。',
    '- 不要写「懒」「不听话」「固执」这类对人品的判断。',
    '- 每条一句话，不超过 40 字。',
    '只输出 JSON：{"patterns":["……"]}',
  ].join('\n')

  const { text, route } = await askModel(ctx, agent, system, request, 900)
  const parsed = parseJsonObject(text, '归纳')
  const raw = Array.isArray(parsed?.patterns) ? parsed.patterns : []
  const patterns = []
  for (const item of raw) {
    const line = clean(typeof item === 'string' ? item : '', DIGEST_MAX_CHARS)
    if (line === '') continue
    if (DIGEST_BANNED.test(line)) continue
    if (patterns.includes(line)) continue
    patterns.push(line)
  }
  const added = []
  for (const line of patterns.slice(0, DIGEST_MAX_WRITTEN)) {
    // source 标成 digest，界面上能一眼认出哪些是归纳出来的、方便删。
    const { record } = await store.rememberLong(
      persona.id,
      { text: line, kind: 'pattern', importance: 4 },
      'digest',
    )
    if (record !== null && record !== undefined) added.push(record)
  }
  return { added, patterns, route }
}
