/**
 * 固定数值与文案。
 *
 * 这里只放「不会变的东西」：预算、上限、默认值、注入用的固定段落。
 * 想调整插件性格就从这里下手，改完重启 DSH 生效。
 */

/** 持久域：人格卡、会话绑定、会话状态、长期记忆四张表。 */
export const DOMAIN_SPEC = {
  name: 'pm_persona',
  version: 1,
  layout: 'single',
  tables: {
    personas: { valueSchema: { parse: (value) => value } },
    bindings: { valueSchema: { parse: (value) => value } },
    states: { valueSchema: { parse: (value) => value } },
    memories: { valueSchema: { parse: (value) => value } },
  },
}

/** 前端唯一通道；改名时连同 client.js 里的 API 常量一起改。 */
export const ROUTE_PATH = '/pm-persona/api'

/** 静态自我认知预算。够放下性格、喜好、习惯和过去，而不是一个标签。 */
export const MAX_CARD_CHARS = 3800
/** 每轮追加的运行时上下文预算。 */
export const MAX_RUNTIME_CHARS = 1100

export const MAX_REPLY_CHARS_LIMIT = 4000
export const MAX_REPLY_CHARS_DEFAULT = 0
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** 会话正史（canon notes）。 */
export const MAX_NOTES = 50
export const MAX_NOTE_CHARS = 1000
export const MAX_NOTE_ITEMS = 8

/** 长期记忆。 */
export const MAX_MEMORIES = 120
export const MAX_MEMORY_ITEMS = 6
export const MAX_MEMORY_CHARS = 600
export const MAX_MEMORY_BACKUPS = 7

export const MEMORY_KINDS = ['fact', 'preference', 'plan', 'event', 'pattern']
export const MEMORY_IMPORTANCE_DEFAULT = 3
/** 归纳出来的结论单独限量：太多会把具体事实挤掉。 */
export const MAX_PATTERN_MEMORIES = 12

/** 自动记忆：只认「我 + 状态动词」的明确陈述，问句和假设一律不碰。 */
export const AUTO_MEMORY_PATTERNS = [
  { kind: 'fact', pattern: /我(?:住在|来自|老家是|在做|在写|在搞|养了|用的是|叫)([^，。！？,.!?\s]{2,18})/ },
  { kind: 'fact', pattern: /我(?:是|做)([一-龥]{2,10}(?:工程师|程序员|学生|老师|设计师|医生|运营|老板))/ },
  { kind: 'preference', pattern: /我(?:喜欢|讨厌|爱吃|不爱吃|受不了|习惯|迷上了)([^，。！？,.!?\s]{2,18})/ },
]
export const AUTO_MEMORY_MAX_PER_HARVEST = 2
/** 自动记忆的节流窗口：同一会话 10 分钟内最多扫一遍。 */
export const MEMORY_HARVEST_MS = 10 * 60_000

/** 归纳记忆。 */
export const DIGEST_MAX_TURNS = 30
export const DIGEST_MAX_WRITTEN = 3
export const DIGEST_MAX_CHARS = 48
/** 一眼就是评价人品的，直接扔掉：一条坏结论会长期污染行为，比漏记更糟。 */
export const DIGEST_BANNED = /懒|不听话|固执|没救|废物|拖延症|不上进|没出息/

/** 表情包频率(%)：约每三条回复一张。 */
export const MEME_FREQUENCY_DEFAULT = 30

/** 对绑定者默认的称呼。默认值不注入任何额外文字。 */
export const MASTER_NAME_DEFAULT = '主人'

export const TEXT_FIELDS = [
  'name',
  'summary',
  'masterName',
  'tagCode',
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

export const FIELD_LIMITS = {
  name: 120,
  summary: 400,
  masterName: 40,
  tagCode: 800,
  identity: 1400,
  traits: 900,
  voice: 1200,
  likes: 700,
  dislikes: 700,
  habits: 700,
  drives: 900,
  relationship: 800,
  relationshipOthers: 800,
  boundaries: 800,
  knowledge: 700,
  examples: 1400,
  lore: 20000,
}

/** 每个板块先拿保底字数（保证不被挤没），剩余预算再按优先级分配。 */
export const SECTION_CAPS = {
  identity: { min: 360, max: 1400 },
  traits: { min: 220, max: 900 },
  voice: { min: 280, max: 1200 },
  likes: { min: 140, max: 700 },
  dislikes: { min: 140, max: 700 },
  habits: { min: 140, max: 700 },
  drives: { min: 220, max: 900 },
  lore: { min: 360, max: 1500 },
  boundaries: { min: 180, max: 800 },
  knowledge: { min: 140, max: 700 },
  relationship: { min: 160, max: 800 },
  relationshipOthers: { min: 140, max: 700 },
  examples: { min: 180, max: 1200 },
  replyLength: { min: 150, max: 260 },
  actionBeats: { min: 160, max: 400 },
  memes: { min: 180, max: 500 },
  masterName: { min: 60, max: 200 },
}

/** 动作描述：短、具体、能看见，不是小说腔。 */
export const ACTION_BEATS_TEXT = [
  '说话时可以带一个小动作，用全角括号括起来：（搬小板凳）（尾巴拍了一下地板）（把抹布放下）。',
  '一段回复最多一个，不是每句都加；动作要短、要具体、能看见，不要写成旁白、心理描写或剧情推进。',
].join('')

/** 「对主人」和「对其他人」两段同时存在时，先提醒模型分清面前是谁。 */
export const WHO_IS_WHO = [
  '分清面前的是谁：主人就是选中你、把这张卡绑在自己身上的那个人（群聊里若消息前缀标了「主人」，那就是他）；',
  '其他人是主人之外的所有人——群友、陌生人、客人、路过围观的人。',
  '对这两类人，你的称呼、亲疏、让步尺度和耐心都不一样，不要混着用；拿不准对方是谁时，先按“其他人”的分寸来。',
].join('')

/** 标签锚点：一行一个 TAG_value，像配置文件，模型会当命令读。 */
export const TAG_CODE_HEADER = '【PERSONA_LOAD】'
export const TAG_CODE_HINT = '(Format anchors, one per line: never read them aloud, never explain them; fill in whatever a tag leaves open, but never contradict one.)'

/** 正史相关性打分时忽略的虚词。 */
export const STOP_TOKENS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'was',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '的', '了', '是', '在',
  '有', '和', '就', '不', '也', '都', '这', '那', '吗', '呢', '吧', '啊', '呀',
  '什么', '怎么', '一个', '现在', '今天', '可以', '没有', '知道', '觉得',
  '这个', '那个', '还是', '但是', '因为', '所以', '已经', '自己', '一下',
])
