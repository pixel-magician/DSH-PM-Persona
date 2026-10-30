/**
 * 冒烟测试：不装进 DSH，也能验证 plugins 的注册和核心逻辑。
 * 跑法：node test/smoke.mjs
 */

import { apply } from '../src/index.js'

/** 极简内存表：get/put/delete/keys/entries，行为对齐 storageDomain 的 table。 */
const tableCache = new Map()
function cached(name) {
  if (!tableCache.has(name)) {
    const store = new Map()
    tableCache.set(name, {
      get: (key) => (store.has(key) ? store.get(key) : null),
      put: async (key, value) => {
        store.set(key, JSON.parse(JSON.stringify(value)))
      },
      delete: async (key) => store.delete(key),
      keys: () => [...store.keys()],
      entries: () => [...store.entries()],
    })
  }
  return tableCache.get(name)
}

const registrations = { sections: [], contexts: [], tools: [], commands: [], routes: [], events: [] }
const messages = []

const mockCtx = {
  logger: { info: () => {}, warn: (msg) => messages.push(`warn: ${msg}`) },
  storageDomain: { open: async () => ({ table: cached, close: () => {} }) },
  effect: (fn) => {
    fn()
    return () => {}
  },
  systemPrompt: {
    section: (spec) => {
      registrations.sections.push(spec)
      return () => {}
    },
    context: (spec) => {
      registrations.contexts.push(spec)
      return () => {}
    },
  },
  tools: {
    register: (tool) => {
      registrations.tools.push(tool)
      return () => {}
    },
  },
  inject: (names, run) => {
    if (names.includes('commands')) {
      run({
        effect: (fn) => fn(),
        commands: {
          register: (command) => {
            registrations.commands.push(command)
            return () => {}
          },
        },
      })
    }
    if (names.includes('webServer')) {
      run({
        effect: (fn) => fn(),
        webServer: {
          register: (spec) => {
            registrations.routes.push(spec)
            return () => {}
          },
          getOrigin: () => 'http://127.0.0.1:5279',
        },
      })
    }
  },
  on: (event, handler) => {
    registrations.events.push({ event, handler })
    return () => {}
  },
  get: (name) => {
    if (name === 'sessions') {
      return {
        get: (id) => mockSessions[id],
      }
    }
    return undefined
  },
}

const mockSessions = {}

await apply(mockCtx)
console.log('sections:', registrations.sections.map((s) => s.name).join(', '))
console.log('contexts:', registrations.contexts.map((s) => s.name).join(', '))
console.log('tools:', registrations.tools.map((t) => t.name).join(', '))
console.log('commands:', registrations.commands.map((c) => c.name).join(', '))
console.log('routes:', registrations.routes.map((r) => r.path).join(', '))

const tool = registrations.tools[0]
const sessionId = 's_test_1'
mockSessions[sessionId] = {
  id: sessionId,
  seq: 1,
  header: { origin: 'root' },
  deriveMessages: () => [
    { role: 'user', content: '我是写 Go 的，喜欢喝冰美式' },
    { role: 'assistant', content: '记住了' },
  ],
}
const exec = { agent: { id: sessionId, session: mockSessions[sessionId] } }

const created = await tool.execute({ action: 'create', name: '测试鱼', summary: '一条测试鱼', traits: '懒散但靠谱' }, exec)
console.log('create:', created.ok, created.message.slice(0, 40))

const remembered = await tool.execute({ action: 'remember', note: '主人喜欢冰美式' }, exec)
console.log('remember:', remembered.ok, remembered.state.notes.length)

const memorized = await tool.execute({ action: 'memorize', memory: '主人是写 Go 的', kind: 'fact', importance: 4 }, exec)
console.log('memorize:', memorized.ok, memorized.message.slice(0, 40))

const shown = await tool.execute({ action: 'show' }, exec)
console.log('show capsule chars:', shown.capsule?.length ?? 0)

const command = registrations.commands[0]
const listed = await command.handler({ agent: { id: sessionId }, rawInput: 'list' })
console.log('command list:', listed.kind, listed.text.split('\n')[0])

const route = registrations.routes[0]
const body = { op: 'snapshot', sessionId }
const fakeRes = {
  status: 0,
  headers: {},
  writeHead(status, headers) {
    this.status = status
    this.headers = headers
  },
  end(text) {
    this.text = text
  },
}
const fakeReq = {
  method: 'POST',
  headers: { origin: 'http://127.0.0.1:5279' },
  on(event, handler) {
    if (event === 'data') handler(Buffer.from(JSON.stringify(body)))
    if (event === 'end') handler()
  },
  destroy: () => {},
}
await route.handler(fakeReq, fakeRes)
const snapshot = JSON.parse(fakeRes.text)
console.log('snapshot ok:', snapshot.ok, 'personas:', snapshot.personas.length, 'active card chars:', snapshot.active?.card.length)

const preview = snapshot.active
console.log('card starts with persona:', preview.card.startsWith('<persona'))
console.log('runtime has moment:', preview.runtime.includes('<persona-moment'))

// 真正注入的两段：section 和 context 的组装回调
const injectedCard = registrations.sections[0].text({ agent: { session: mockSessions[sessionId] } })
const injectedMoment = registrations.contexts[0].text({ agent: { session: mockSessions[sessionId] } })
const subCard = registrations.sections[0].text({
  agent: { session: { id: 's_sub', header: { origin: 'subagent' } } },
})
console.log('section injects card:', injectedCard.startsWith('<persona'))
console.log('context injects memories:', injectedMoment.includes('[Long-term memories]'))
console.log('subagent isolated:', subCard === '')
console.log('no peek/purpose leak:', !/peek|purpose/i.test(injectedCard + injectedMoment))
console.log('events:', registrations.events.map((e) => e.event).join(', '))
console.log(messages.length > 0 ? messages.join('\n') : 'no warnings')
