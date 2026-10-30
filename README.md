# 人格工坊·自用版（pm-persona）

从 [`ShiLaiM/dsh-persona-L`](https://github.com/ShiLaiM/dsh-persona-L)（MIT）复刻并重构成的模块化版本。
目标不是功能更多，而是**能读、能改、能加**。

和原版相比，砍掉了三块：

| 砍掉的 | 原因 |
|---|---|
| 窥屏（PeekPilot + PowerShell 截图） | Windows 专属、拉起隐藏会话、依赖截图权限 |
| 目的机制（P0 定时主动） | 和窥屏是同一类「自己找话说」，一起砍最省心 |
| 惦记（seeds 承诺提醒） | 只为「到点主动问」服务，没有主动机制就没有意义 |

保留并重写的核心：人格卡、静态自我认知、运行时上下文、会话正史、长期记忆（衰减 / 合并 / 分人 / 备份）、补完、归纳、工具、斜杠命令、REST、前端。

---

## 装上它

`dsh plugin` 只是把参数转发给 profile 目录里的 pnpm。三种装法任选：

```bash
# npm（发布之后，最省事）
dsh plugin --profile desktop add pm-persona

# 本地开发（改代码即时生效，不用重发）
dsh plugin --profile desktop add link:D:\WorkSpace\DeepSeek-Harness\默认项目\pm-persona

# GitHub
dsh plugin --profile desktop add github:<你的账号>/pm-persona
```

也可以走 Web UI：侧栏「插件」→「添加插件」，输入 `pm-persona`，inspect 会先显示版本、简介，确认后再装。

然后把包名加进 profile 的 bundle 列表 —— 这一步 pnpm 不会替你做。
编辑 `~/.dsh/profiles/desktop/package.json`，在 `dsh.profile.bundles` 数组里加一行：

```json
"pm-persona"
```

（顺序随意，放在 `@deepseek-ai/dsh-web-app` 之后即可。）改完重启 DSH。

### 发布到 npm

```bash
npm login
npm publish          # prepublishOnly 会先跑一遍 test/smoke.mjs

# 以后更新
npm version patch    # 或 minor / major
npm publish
```

同一个版本号不能重复发布，必须先 bump；记得同步 push GitHub。

装完在设置 → 插件里确认「人格工坊·自用版」已启用，左侧栏出现「人格」图标，输入框上方出现人格条。

**和原版并存？** 可以。存储域（`pm_persona`）、路由（`/pm-persona/api`）、提示段落名（`pm-persona:*`）、slot id、工具名（`pm-persona`）、命令（`/pm-persona`）全都和原版不同名，两个插件同时装着也不会抢。
想替换原版：先在设置里停用 `@local/dsh-persona`（或从 bundles 里删掉），再用这个。

---

## 目录

```text
pm-persona/
├─ package.json        # dsh.bundle.patch + dsh.client 声明
├─ cordis.patch.yml    # 往 profile 树里插一行
├─ client.js           # 前端单文件（React，window.__ModuleLoader__ 格式）
├─ locale/             # 插件市场里的标题/描述
├─ icon.svg
├─ src/
│  ├─ index.js         # 入口：七处接线（存储/两段注入/工具/命令/REST/fork/自动记忆）
│  ├─ constants.js     # 预算、上限、默认值、固定段落文案 —— 想调性格先看这里
│  ├─ util.js          # 清洗、转义、JSON 安全化、时间格式
│  ├─ card.js          # 字段清洗 normalizePersona + 静态卡 compileCard（两轮预算）
│  ├─ runtime.js       # 每轮的 [Scene]/[Mood]/正史/长期记忆 compileRuntime
│  ├─ notes.js         # 会话正史：选择、打分、预算
│  ├─ memory.js        # 长期记忆：鲜活度、合并、分人、自动挖
│  ├─ store.js         # PersonaStore：四张表 + 绑定 + 正史 + 记忆
│  ├─ enrich.js        # 调模型：补完（enrich）与归纳（digest）
│  ├─ tool.js          # pm-persona 工具（16 个 action）
│  ├─ command.js       # /pm-persona 斜杠命令
│  └─ http.js          # REST：26 个 op，前端唯一通道
└─ test/smoke.mjs      # 不装 DSH 也能跑：mock ctx + 核心链路
```

## 数据

持久域 `pm_persona`，默认落在：

```text
~/.dsh/storages/pm_persona.json
```

四张表：`personas`（卡片库）、`bindings`（会话 → 卡）、`states`（场景/心情/正史）、`memories`（长期记忆 + `#backup#` 快照）。

## 加你自己的功能

| 想加 | 改哪 |
|---|---|
| 新的人格字段 | `constants.js` 的 `TEXT_FIELDS`/`FIELD_LIMITS` → `card.js` 的 `normalizePersona`、`summaryOf`、`compileCard` 的 `add()`、`deriveTagCode` → `client.js` 的 `GROUPS` |
| 新的注入段落 | `runtime.js` 的 `compileRuntime` 往 `blocks` 里 push 一段，事件和预算都自动生效 |
| 新的模型动作 | `tool.js`：`enum` 加一项、`parameters` 加参数、`execute` 加分支、`toolPatch` 加透传 |
| 新的定时行为 | 仿 `index.js` 里的自动记忆：`ctx.on('session/event')` 或 `setInterval`，记得 10 分钟级节流 |
| 新的前端面板 | `client.js`：`ctx.slots.inject('<slot>', () => ctx.slots.register(spec, Component))`，数据走 `api('你的op')` |
| 新的 REST 能力 | `http.js` 的 `op ===` 链加分支 |
| 换补完用的模型 | `enrich.js` 的 `routeFor` / `askModel` |

改完 `src/*.js` 要重启 DSH；改 `client.js` 刷新页面。

## 测试

```bash
node test/smoke.mjs
```

会 mock 一个 ctx，验证：注册、建卡、正史、长期记忆、静态/运行时注入、子 agent 隔离、命令、REST。

## 许可与出处

MIT。原始设计与大部分行为来自 [dsh-persona-L](https://github.com/ShiLaiM/dsh-persona-L)（Copyright ShiLaiM），本仓库是其去主动机制后的模块化重写。
