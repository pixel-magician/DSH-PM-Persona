window.__ModuleLoader__.load({
  id: 'pm-persona',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const API = '/pm-persona/api'
    const PANEL_ID = 'pm-persona'
    const RUNTIME = { layout: null }

    async function api(op, payload) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...(payload ?? {}) }),
      })
      let data
      try {
        data = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`)
      return data
    }

    const errText = (cause) => (cause instanceof Error ? cause.message : String(cause))

    const CSS = `
.dsh-pm-dock { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.dsh-pm-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 3px 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; }
.dsh-pm-chip[data-on="true"] { border-color: var(--dsw-alias-label-accent, #4f7cff); }
.dsh-pm-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
.dsh-pm-dot[data-on="true"] { background: var(--dsw-alias-label-accent, #4f7cff); }
.dsh-pm-muted { color: var(--dsw-alias-label-secondary); }
.dsh-pm-panel { margin-top: 6px; width: min(560px, 92vw); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 10px 30px rgba(0,0,0,.16); overflow: hidden; }
.dsh-pm-search { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 8px 10px; font: inherit; font-size: 12px; background: transparent; color: inherit; }
.dsh-pm-list { max-height: 280px; overflow: auto; }
.dsh-pm-item { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); background: transparent; padding: 8px 10px; font: inherit; font-size: 12px; color: inherit; cursor: pointer; }
.dsh-pm-item:hover { background: var(--dsw-alias-fill-l1, rgba(0,0,0,.05)); }
.dsh-pm-item[data-active="true"] { background: var(--dsw-alias-fill-l1, rgba(0,0,0,.07)); font-weight: 600; }
.dsh-pm-item small { color: var(--dsw-alias-label-secondary); font-weight: 400; }
.dsh-pm-item-none { color: var(--dsw-alias-label-secondary); }
.dsh-pm-foot { display: flex; align-items: center; gap: 8px; padding: 7px 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-pm-btn { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: transparent; color: inherit; font: inherit; font-size: 12px; padding: 3px 9px; cursor: pointer; }
.dsh-pm-btn:hover { background: var(--dsw-alias-fill-l1, rgba(0,0,0,.05)); }
.dsh-pm-btn[data-primary="true"] { background: var(--dsw-alias-label-accent, #4f7cff); color: #fff; border-color: transparent; }
.dsh-pm-btn:disabled { opacity: .5; cursor: default; }
.dsh-pm-error { color: var(--dsw-alias-state-error-primary, #d33); font-size: 11px; padding: 0 10px 8px; }
.dsh-pm-page { height: 100%; overflow: auto; padding: 18px 22px; }
.dsh-pm-page-inner { max-width: 980px; margin: 0 auto; }
.dsh-pm-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.dsh-pm-head h2 { margin: 0; font-size: 16px; }
.dsh-pm-head .dsh-pm-muted { font-size: 12px; }
.dsh-pm-head-actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-pm-settings { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
.dsh-pm-side { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; }
.dsh-pm-side-head { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-pm-side-head input { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 12px; padding: 4px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: transparent; color: inherit; }
.dsh-pm-side-list { max-height: 60vh; overflow: auto; }
.dsh-pm-body { min-width: 0; }
.dsh-pm-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
.dsh-pm-tab { border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 12px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-pm-tab[data-on="true"] { background: var(--dsw-alias-fill-l1, rgba(0,0,0,.06)); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-pm-section { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
.dsh-pm-section > summary { cursor: pointer; padding: 8px 12px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.dsh-pm-section-body { padding: 4px 12px 12px; display: grid; gap: 10px; }
.dsh-pm-field { display: grid; gap: 4px; }
.dsh-pm-field label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-pm-field input[type="text"], .dsh-pm-field textarea, .dsh-pm-field select { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; line-height: 1.6; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: transparent; color: inherit; resize: vertical; }
.dsh-pm-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 12px; }
.dsh-pm-check { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; }
.dsh-pm-preview pre { margin: 0; max-height: 480px; overflow: auto; white-space: pre-wrap; word-break: break-word; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); padding: 10px; font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dsh-pm-memrow { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; font-size: 12px; margin-bottom: 6px; }
.dsh-pm-memmain { flex: 1 1 auto; min-width: 0; }
.dsh-pm-memmeta { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-bottom: 2px; }
.dsh-pm-memtext { word-break: break-word; }
.dsh-pm-placeholder { border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; padding: 34px 18px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.8; }
@media (max-width: 760px) { .dsh-pm-settings { grid-template-columns: 1fr; } .dsh-pm-side-list { max-height: 200px; } }
`

    function Style() {
      return h('style', null, CSS)
    }

    /** 一组一组的编辑字段。 */
    const GROUPS = [
      {
        title: '基本',
        fields: [
          ['name', '名字', false],
          ['summary', '一句话设定', true],
          ['masterName', '对主人的称呼（默认「主人」）', false],
          ['tags', '标签（用逗号分隔）', false],
        ],
      },
      {
        title: '怎么说话',
        fields: [
          ['voice', '语气、口癖、称呼方式', true],
          ['examples', '示例台词（2–4 句）', true],
          ['maxReplyChars', '单次回复字数上限（0 = 不限）', false],
        ],
      },
      {
        title: '性格',
        fields: [
          ['identity', '你是谁：身份锚点', true],
          ['traits', '性格特质与矛盾', true],
          ['likes', '喜欢什么', true],
          ['dislikes', '讨厌什么、怕什么', true],
          ['habits', '习惯和小动作', true],
          ['drives', '想要什么、什么在拉扯你', true],
        ],
      },
      {
        title: '关系与边界',
        fields: [
          ['relationship', '对「主人」的态度', true],
          ['relationshipOthers', '对「其他人」的态度', true],
          ['boundaries', '硬边界、禁忌', true],
          ['knowledge', '知识范围（知道什么、不知道什么）', true],
        ],
      },
      {
        title: '例子与背景',
        fields: [['lore', '过去 / 个人史', true]],
      },
      {
        title: '标签锚点（PERSONA_LOAD）',
        fields: [['tagCode', '一行一个 TAG_value；留空则按卡片自动生成', true]],
      },
    ]

    function emptyDraft() {
      return {
        name: '',
        summary: '',
        masterName: '主人',
        tags: [],
        identity: '',
        traits: '',
        voice: '',
        likes: '',
        dislikes: '',
        habits: '',
        drives: '',
        relationship: '',
        relationshipOthers: '',
        boundaries: '',
        knowledge: '',
        examples: '',
        lore: '',
        tagCode: '',
        maxReplyChars: 0,
        injectLore: true,
        injectTags: true,
        useActions: false,
        useMemes: false,
        memeFrequency: 30,
        autoMemory: false,
      }
    }

    function Field({ label, value, onChange, multiline, rows = 3, numeric }) {
      if (numeric) {
        return h('div', { className: 'dsh-pm-field' },
          h('label', null, label),
          h('input', {
            type: 'text',
            inputMode: 'numeric',
            value: String(value ?? ''),
            onChange: (event) => onChange(event.target.value),
          }),
        )
      }
      return h('div', { className: 'dsh-pm-field' },
        h('label', null, label),
        multiline
          ? h('textarea', {
              rows,
              value: String(value ?? ''),
              onChange: (event) => onChange(event.target.value),
            })
          : h('input', {
              type: 'text',
              value: String(value ?? ''),
              onChange: (event) => onChange(event.target.value),
            }),
      )
    }

    /** 输入框上方的横条 + 面板。 */
    function PersonaDock(props) {
      const sessionId = props.sessionId ?? props.session?.id
      const [snapshot, setSnapshot] = useState(null)
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [self, setSelf] = useState(null)

      const load = useCallback(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        try {
          const data = await api('snapshot', { sessionId })
          setSnapshot(data)
          setError('')
        } catch (cause) {
          setError(errText(cause))
        }
      }, [sessionId])

      useEffect(() => {
        setSnapshot(null)
        setOpen(false)
        setSelf(null)
        void load()
      }, [load])

      useEffect(() => {
        const onFocus = () => { void load() }
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [load])

      if (typeof sessionId !== 'string' || sessionId === '') return null

      const active = snapshot?.active ?? null
      const personas = snapshot?.personas ?? []
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return personas
        return personas.filter((persona) =>
          String(persona.name ?? '').toLowerCase().includes(needle)
          || String(persona.summary ?? '').toLowerCase().includes(needle)
          || (persona.tags ?? []).some((tag) => String(tag).toLowerCase().includes(needle)),
        )
      }, [personas, query])

      const run = async (fn) => {
        setBusy(true)
        setError('')
        try {
          await fn()
          await load()
        } catch (cause) {
          setError(errText(cause))
        } finally {
          setBusy(false)
        }
      }

      const pick = (id) => run(async () => {
        await api('use', { sessionId, id })
        setOpen(false)
      })

      const clear = () => run(async () => {
        await api('off', { sessionId })
        setOpen(false)
      })

      const openPanel = () => {
        try {
          const layout = RUNTIME.layout
          if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
            layout.selectPanel(PANEL_ID)
            setOpen(false)
            return
          }
        } catch (cause) {
          setError(errText(cause))
          return
        }
        setError('布局服务不可用，请从左侧栏的「人格」图标进入。')
      }

      const showSelf = () => {
        if (active === null) return
        setSelf(active)
        setOpen(false)
      }

      const enrich = () => run(async () => {
        const data = await api('enrich', { id: active?.persona?.id, sessionId })
        if (data.changed !== true) setError('字段已经比较完整，没有可补的。')
      })

      return h('div', null,
        h(Style),
        h('div', { className: 'dsh-pm-dock' },
          h('button', {
            type: 'button',
            className: 'dsh-pm-chip',
            'data-on': active !== null,
            onClick: () => setOpen((value) => !value),
            title: '切换人格',
          },
            h('span', { className: 'dsh-pm-dot', 'data-on': active !== null }),
            active === null ? '不使用人格' : active.persona.name,
          ),
          active === null ? null : h('button', {
            type: 'button',
            className: 'dsh-pm-btn',
            onClick: showSelf,
            title: '查看此刻注入的自我认知',
          }, '◉ 自我认知'),
          active === null ? null : h('button', {
            type: 'button',
            className: 'dsh-pm-btn',
            disabled: busy,
            onClick: enrich,
            title: '让模型把空字段补成可演的内容',
          }, '补完'),
          h('span', { className: 'dsh-pm-muted' }, busy ? '处理中…' : ''),
        ),
        open ? h('div', { className: 'dsh-pm-panel' },
          h('input', {
            className: 'dsh-pm-search',
            placeholder: '搜索人格…',
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h('div', { className: 'dsh-pm-list' },
            h('button', {
              type: 'button',
              className: 'dsh-pm-item',
              'data-active': active === null,
              onClick: clear,
            },
              h('span', { className: 'dsh-pm-item-none' }, '不使用人格'),
              h('small', null, '恢复默认助手'),
            ),
            filtered.length === 0
              ? h('div', { className: 'dsh-pm-foot dsh-pm-item-none' }, '人格库是空的，去「人格」页新建一张。')
              : filtered.map((persona) => h('button', {
                  key: persona.id,
                  type: 'button',
                  className: 'dsh-pm-item',
                  'data-active': active?.persona?.id === persona.id,
                  onClick: () => pick(persona.id),
                },
                  h('span', null, persona.name),
                  persona.summary ? h('small', null, persona.summary) : null,
                )),
          ),
          h('div', { className: 'dsh-pm-foot' },
            h('button', { type: 'button', className: 'dsh-pm-btn', onClick: openPanel }, '打开人格页'),
            h('button', { type: 'button', className: 'dsh-pm-btn', onClick: () => void load() }, '刷新'),
          ),
        ) : null,
        error !== '' ? h('div', { className: 'dsh-pm-error' }, error) : null,
        self !== null ? h('div', { className: 'dsh-pm-panel' },
          h('div', { className: 'dsh-pm-foot' },
            h('span', null, `此刻注入「${self.persona.name}」：卡片 ${self.card.length} 字 + 运行时 ${self.runtime.length} 字`),
            h('button', { type: 'button', className: 'dsh-pm-btn', onClick: () => setSelf(null) }, '收起'),
          ),
          h('div', { className: 'dsh-pm-preview' }, h('pre', null, self.capsule)),
        ) : null,
      )
    }

    /** 侧栏图标。 */
    function PersonaNavIcon({ size = 16 } = {}) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('circle', { cx: 8, cy: 5, r: 2.6 }),
        h('path', { d: 'M3 14c0-2.6 2.2-4.4 5-4.4s5 1.8 5 4.4' }),
        h('path', { d: 'M2.2 2.6 3.6 3.6M13.8 2.6 12.4 3.6' }),
      )
    }

    /** 一级页面：卡片库 + 编辑 + 记忆 + 预览。 */
    function PersonaPage() {
      const [snapshot, setSnapshot] = useState(null)
      const [selectedId, setSelectedId] = useState('')
      const [draft, setDraft] = useState(null)
      const [tab, setTab] = useState('settings')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [status, setStatus] = useState('')
      const [preview, setPreview] = useState(null)
      const [memories, setMemories] = useState([])
      const [memQuery, setMemQuery] = useState('')
      const [sideQuery, setSideQuery] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await api('snapshot', {})
          setSnapshot(data)
          setError('')
          return data
        } catch (cause) {
          setError(errText(cause))
          return null
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const openPersona = useCallback(async (id) => {
        if (typeof id !== 'string' || id === '') return
        try {
          const data = await api('get', { id })
          setSelectedId(id)
          setDraft({ ...data.persona, tagsText: (data.persona.tags ?? []).join(', ') })
          setPreview(null)
          setStatus('')
          setError('')
        } catch (cause) {
          setError(errText(cause))
        }
      }, [])

      useEffect(() => {
        if (selectedId === '') return
        api('memory-list', { id: selectedId })
          .then((data) => setMemories(data.memories ?? []))
          .catch((cause) => setError(errText(cause)))
      }, [selectedId, status])

      const personas = snapshot?.personas ?? []
      const filteredPersonas = useMemo(() => {
        const needle = sideQuery.trim().toLowerCase()
        if (needle === '') return personas
        return personas.filter((persona) => String(persona.name ?? '').toLowerCase().includes(needle))
      }, [personas, sideQuery])

      const setField = (field, value) => {
        setDraft((current) => (current === null ? current : { ...current, [field]: value }))
      }

      const save = async () => {
        if (draft === null) return
        setBusy(true)
        setError('')
        try {
          const patch = { ...draft }
          delete patch.tagsText
          delete patch.id
          delete patch.createdAt
          delete patch.updatedAt
          patch.tags = String(draft.tagsText ?? '')
            .split(/[,，、]/)
            .map((tag) => tag.trim())
            .filter((tag) => tag !== '')
          patch.maxReplyChars = Number(draft.maxReplyChars) || 0
          let saved
          if (selectedId === '') {
            saved = await api('create', { persona: { ...patch, name: patch.name || '未命名人格' } })
            setSelectedId(saved.persona.id)
          } else {
            saved = await api('update', { id: selectedId, patch })
          }
          setDraft({ ...saved.persona, tagsText: (saved.persona.tags ?? []).join(', ') })
          setStatus(`已保存 · revision ${saved.persona.revision}`)
          await load()
        } catch (cause) {
          setError(errText(cause))
        } finally {
          setBusy(false)
        }
      }

      const createNew = () => {
        setSelectedId('')
        setDraft({ ...emptyDraft(), tagsText: '' })
        setPreview(null)
        setStatus('新人格，填好名字后保存')
        setError('')
      }

      const remove = async () => {
        if (selectedId === '') return
        setBusy(true)
        try {
          await api('delete', { id: selectedId })
          setSelectedId('')
          setDraft(null)
          setStatus('已删除')
          await load()
        } catch (cause) {
          setError(errText(cause))
        } finally {
          setBusy(false)
        }
      }

      const doPreview = async () => {
        if (selectedId === '') return
        try {
          const data = await api('preview', { id: selectedId })
          setPreview(data)
          setTab('preview')
        } catch (cause) {
          setError(errText(cause))
        }
      }

      const exportAll = async () => {
        try {
          const data = await api('export', {})
          const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `personas-${new Date().toISOString().slice(0, 10)}.json`
          anchor.click()
          URL.revokeObjectURL(url)
        } catch (cause) {
          setError(errText(cause))
        }
      }

      const importFile = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (file === undefined) return
          try {
            const data = JSON.parse(await file.text())
            const result = await api('import', { data, mode: 'merge' })
            setStatus(`已导入 ${result.personas} 张卡`)
            await load()
          } catch (cause) {
            setError(errText(cause))
          }
        }
        input.click()
      }

      const addMemory = async () => {
        if (selectedId === '') return
        const text = window.prompt('要记一条什么？（会存进这张卡的长期记忆）')
        if (text === null || text.trim() === '') return
        try {
          await api('memory-add', { id: selectedId, text: text.trim(), importance: 3 })
          setStatus('已加一条记忆')
          const data = await api('memory-list', { id: selectedId })
          setMemories(data.memories ?? [])
        } catch (cause) {
          setError(errText(cause))
        }
      }

      const prune = async () => {
        if (selectedId === '') return
        try {
          const data = await api('memory-prune', { id: selectedId, below: 0.15 })
          setStatus(`清掉 ${data.removed} 条已淡忘的记忆`)
          const list = await api('memory-list', { id: selectedId })
          setMemories(list.memories ?? [])
        } catch (cause) {
          setError(errText(cause))
        }
      }

      const memoryFiltered = memories.filter((memory) =>
        memQuery.trim() === '' || String(memory.text).includes(memQuery.trim())
      )

      const settings = draft === null
        ? h('div', { className: 'dsh-pm-placeholder' }, '左边选一张卡，或者点「新建」写一张新的。')
        : h('div', null,
            GROUPS.map((group) => h('details', { key: group.title, className: 'dsh-pm-section', open: group.title === '基本' },
              h('summary', null, group.title),
              h('div', { className: 'dsh-pm-section-body' },
                group.fields.map(([field, label, multiline]) => h(Field, {
                  key: field,
                  label,
                  multiline,
                  numeric: field === 'maxReplyChars',
                  value: field === 'tags' ? draft.tagsText : draft[field],
                  onChange: field === 'tags'
                    ? (value) => setField('tagsText', value)
                    : (value) => setField(field, value),
                })),
                group.title === '基本'
                  ? h('div', { className: 'dsh-pm-row' },
                      h('label', { className: 'dsh-pm-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: draft.injectTags !== false,
                          onChange: (event) => setField('injectTags', event.target.checked),
                        }),
                        '注入标签锚点',
                      ),
                      h('label', { className: 'dsh-pm-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: draft.injectLore !== false,
                          onChange: (event) => setField('injectLore', event.target.checked),
                        }),
                        '注入背景',
                      ),
                    )
                  : null,
                group.title === '怎么说话'
                  ? h('div', { className: 'dsh-pm-row' },
                      h('label', { className: 'dsh-pm-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: draft.useActions === true,
                          onChange: (event) => setField('useActions', event.target.checked),
                        }),
                        '允许动作描述',
                      ),
                      h('label', { className: 'dsh-pm-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: draft.useMemes === true,
                          onChange: (event) => setField('useMemes', event.target.checked),
                        }),
                        '允许表情包',
                      ),
                      h('label', { className: 'dsh-pm-check' },
                        '频率',
                        h('input', {
                          type: 'text',
                          inputMode: 'numeric',
                          style: { width: '52px' },
                          value: String(draft.memeFrequency ?? 30),
                          onChange: (event) => setField('memeFrequency', event.target.value),
                        }),
                        '%',
                      ),
                    )
                  : null,
                group.title === '关系与边界'
                  ? h('div', { className: 'dsh-pm-row' },
                      h('label', { className: 'dsh-pm-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: draft.autoMemory === true,
                          onChange: (event) => setField('autoMemory', event.target.checked),
                        }),
                        '开启自动记忆（模型自己判断要不要记）',
                      ),
                    )
                  : null,
              ),
            )),
            h('div', { className: 'dsh-pm-row', style: { marginTop: '10px' } },
              h('button', {
                type: 'button',
                className: 'dsh-pm-btn',
                'data-primary': true,
                disabled: busy,
                onClick: save,
              }, busy ? '保存中…' : '保存'),
              h('button', { type: 'button', className: 'dsh-pm-btn', onClick: doPreview }, '预览注入'),
              selectedId === '' ? null : h('button', { type: 'button', className: 'dsh-pm-btn', onClick: remove }, '删除这张卡'),
              status !== '' ? h('span', { className: 'dsh-pm-muted' }, status) : null,
            ),
          )

      const memoryView = selectedId === ''
        ? h('div', { className: 'dsh-pm-placeholder' }, '先选中一张卡。')
        : h('div', null,
            h('div', { className: 'dsh-pm-row', style: { marginBottom: '8px' } },
              h('input', {
                type: 'text',
                placeholder: '搜索记忆…',
                value: memQuery,
                onChange: (event) => setMemQuery(event.target.value),
                style: { flex: '1 1 180px', minWidth: '120px' },
              }),
              h('button', { type: 'button', className: 'dsh-pm-btn', onClick: addMemory }, '补一条'),
              h('button', { type: 'button', className: 'dsh-pm-btn', onClick: prune }, '清掉已淡忘'),
            ),
            memoryFiltered.length === 0
              ? h('div', { className: 'dsh-pm-placeholder' }, '还没有长期记忆。聊天里模型用 memorize 写，或者点「补一条」。')
              : memoryFiltered.map((memory) => h('div', { key: memory.id, className: 'dsh-pm-memrow' },
                  h('div', { className: 'dsh-pm-memmain' },
                    h('div', { className: 'dsh-pm-memmeta' },
                      `${new Date(memory.createdAt).toLocaleDateString('zh-CN')} · ${memory.kind} · 重要度 ${memory.importance} · 鲜活 ${Math.round(memory.clarity * 100)}%`,
                      memory.pinned === true ? ' · 📌' : '',
                      memory.firstMet === true ? ' · 初遇' : '',
                      memory.mergedCount > 1 ? ` · 合并 ${memory.mergedCount}` : '',
                      memory.owner !== '' ? ` · ${memory.owner}` : '',
                    ),
                    h('div', { className: 'dsh-pm-memtext' }, memory.text),
                  ),
                  h('div', { style: { display: 'flex', gap: '4px', flexDirection: 'column' } },
                    h('button', {
                      type: 'button',
                      className: 'dsh-pm-btn',
                      onClick: async () => {
                        try {
                          await api('memory-pin', { id: selectedId, memoryId: memory.id, pinned: memory.pinned !== true })
                          const list = await api('memory-list', { id: selectedId })
                          setMemories(list.memories ?? [])
                        } catch (cause) {
                          setError(errText(cause))
                        }
                      },
                    }, memory.pinned ? '取消置顶' : '置顶'),
                    h('button', {
                      type: 'button',
                      className: 'dsh-pm-btn',
                      onClick: async () => {
                        try {
                          await api('memory-forget', { id: selectedId, memoryId: memory.id })
                          const list = await api('memory-list', { id: selectedId })
                          setMemories(list.memories ?? [])
                        } catch (cause) {
                          setError(errText(cause))
                        }
                      },
                    }, '删'),
                  ),
                )),
          )

      const previewView = preview === null
        ? h('div', { className: 'dsh-pm-placeholder' }, '点「预览注入」看这张卡实际会变成什么。')
        : h('div', { className: 'dsh-pm-preview' },
            h('div', { className: 'dsh-pm-row', style: { marginBottom: '6px' } },
              h('span', { className: 'dsh-pm-muted' }, `卡片 ${preview.card.length} 字 + 运行时 ${preview.runtime.length} 字 / 预算 ${preview.budget}`),
            ),
            h('pre', null, preview.capsule),
          )

      return h('div', { className: 'dsh-pm-page' },
        h(Style),
        h('div', { className: 'dsh-pm-page-inner' },
          h('div', { className: 'dsh-pm-head' },
            h('h2', null, '人格'),
            h('span', { className: 'dsh-pm-muted' }, `${personas.length} 张卡 · 切卡只影响当前会话`),
            h('div', { className: 'dsh-pm-head-actions' },
              h('button', { type: 'button', className: 'dsh-pm-btn', onClick: createNew }, '新建'),
              h('button', { type: 'button', className: 'dsh-pm-btn', onClick: importFile }, '导入'),
              h('button', { type: 'button', className: 'dsh-pm-btn', onClick: exportAll }, '导出'),
            ),
          ),
          error !== '' ? h('div', { className: 'dsh-pm-error' }, error) : null,
          h('div', { className: 'dsh-pm-settings' },
            h('div', { className: 'dsh-pm-side' },
              h('div', { className: 'dsh-pm-side-head' },
                h('input', {
                  type: 'text',
                  placeholder: '筛选…',
                  value: sideQuery,
                  onChange: (event) => setSideQuery(event.target.value),
                }),
              ),
              h('div', { className: 'dsh-pm-side-list' },
                filteredPersonas.length === 0
                  ? h('div', { className: 'dsh-pm-placeholder' }, '还没有人格卡')
                  : filteredPersonas.map((persona) => h('button', {
                      key: persona.id,
                      type: 'button',
                      className: 'dsh-pm-item',
                      'data-active': selectedId === persona.id,
                      onClick: () => void openPersona(persona.id),
                    },
                      h('span', null, persona.name),
                      h('small', null, persona.summary || `revision ${persona.revision}`),
                    )),
              ),
            ),
            h('div', { className: 'dsh-pm-body' },
              h('div', { className: 'dsh-pm-tabs' },
                [['settings', '设定'], ['memory', '记忆'], ['preview', '预览']].map(([key, label]) =>
                  h('button', {
                    key,
                    type: 'button',
                    className: 'dsh-pm-tab',
                    'data-on': tab === key,
                    onClick: () => setTab(key),
                  }, label)),
              ),
              tab === 'settings' ? settings : tab === 'memory' ? memoryView : previewView,
            ),
          ),
        ),
      )
    }

    /** 出错时兜底，别让一颗坏卡把整个页面白屏。 */
    class PersonaBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'dsh-pm-placeholder' }, `人格界面出错了：${errText(this.state.error)}`)
        }
        return this.props.children
      }
    }

    function PersonaDockSafe(props) {
      return h(PersonaBoundary, null, h(PersonaDock, props))
    }

    function PersonaPageSafe() {
      return h(PersonaBoundary, null, h(PersonaPage))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          const layout = typeof ctx.get === 'function' ? ctx.get('layout') : null
          RUNTIME.layout = layout ?? null
        } catch {
          RUNTIME.layout = null
        }

        ctx.effect(() => ctx.locale.register(PANEL_ID, {
          zh: { 'nav.persona': '人格' },
          en: { 'nav.persona': 'Persona' },
        }), 'pm-persona: locale')

        const t = (key) => (key === 'nav.persona' ? '人格' : key)

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: PANEL_ID,
          order: 30,
        }, PersonaDockSafe))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => t('nav.persona'),
          locale: PANEL_ID,
        }, PersonaNavIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: PANEL_ID,
        }, PersonaPageSafe))
      },
    }
  },
})
