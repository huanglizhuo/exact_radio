# 实现计划：Radio（Exact + radio-browser）网络电台 App


> **实现状态（2026-11-15）**：P0 技术验证与 P1 骨架已完成，三端（Web/macOS/iOS 模拟器）均构建并跑通数据、搜索、路由、收藏、播放与 Media Session。随机模式（收音机 tab）已在 P2 之后追加实现：`/json/stations/search?order=random` 取随机台，指针角度由 uuid 派生的「频率」决定，换台带 650ms 调谐动效。

P2 已完成大部分（播放面板、错误码提示与重试/换台、最近收听、分页加载、搜索历史、音量、应用图标；睡眠定时器后来按需求移除），语言/编码筛选与失败流自动跳过未做。实际踩到的坑与偏差见 `docs/04-build-log.md`。

> 目标：一个 App，同时上 Web / iOS / macOS，收听 radio-browser.info 目录里的 5.2 万个网络电台。
> 前置调研：[`01-research-exact.md`](./01-research-exact.md)、[`02-research-radio-browser.md`](./02-research-radio-browser.md)。
> 版本：v1 草稿（2026-11-15）。

---

## 0. 结论先行

**可行，但要用"验证优先"的方式做。** 三句话概括调研结论：

1. Exact 的音频能力**刚好覆盖**这个产品的核心需求：长音频流（`audio` 元素）、后台播放（iOS `audio_session: playback` + `backgroundModes: audio`）、锁屏/媒体键（`metadata=MediaMetadata` + `previoustrack/nexttrack/stop`）、稳定错误码（`network/decode/src-not-supported/not-allowed`）。这些我都逐条在文档里核实过，不是推测。
2. radio-browser **不需要后端**：CORS 全开，浏览器可直连；5.2 万站、热门榜 3000 条仅 3.4 MB；允许镜像数据，可以做随包种子。但它**没有"正在播放"接口**，数据脏（39% 无图标、名字带前导空格、IPTV 混入），客户端必须做规范化层。
3. 真正的风险不在功能，而在**跨平台的 HTTP 流不一致**（约 35% 的台是 http：Web 页会被混合内容拦截、iOS/macOS 需要关闭 ATS），以及 **Exact 是 pre-1.0、无生态**（不能接分析/崩溃/广告 SDK）。

因此计划把 **P0（技术验证，3 天）设为 go/no-go 关卡**：先用最小 App 验证"三端都能播 6 类流 + 后台/锁屏 + 首帧时间"，再决定是否全量投入。P0 不过，退路是 React Native + `react-native-track-player`（Web 端单独一套），计划里也给了触发条件。

**总量估算**：单人 15 个开发日（P0 3 + P1 4 + P2 5 + P3 3），加 20% buffer 约 3.5 周；若首次接触 Rust 工具链与 Contract 语言，按 5–6 周估。

---

## 1. 产品定义

### 1.1 一句话

> 打开就能听到世界的电台：三端一致、启动即播、锁屏可控、可收藏、可按国家/语言/曲风/码率筛。

### 1.2 目标用户与场景

| 场景 | 需求 | 设计含义 |
| --- | --- | --- |
| 工作/学习时的背景声 | 一键播放、不折腾 | 首页首屏必须有"继续收听"和"今日热门"，不多于 2 次点击出声 |
| 想听某个国家的台 | 按国家/语言浏览 | 国家/语言筛选是第一优先级 |
| 找特定风格（jazz/lofi/news） | 标签浏览 | 标签云 + 标签详情页 |
| 通勤/健身（iOS） | 锁屏控制、后台不断 | 媒体会话、后台音频、封面图必须正确 |
| 办公（macOS） | 常驻播放、媒体键、窗口可缩放 | 宽窗口两栏布局、⌘ 媒体键、菜单栏播放控制（可选） |
| 网页随手听 | 免安装、可分享链接 | 路由即 URL、深链到标签/国家页 |

### 1.3 MVP 范围（P1–P2 交付）

- 发现页：今日热门 / 最近被点播 / 按国家 / 按语言 / 按标签
- 搜索：名称 + 国家/语言/标签筛选 + 码率筛选 + 分页加载
- 播放：单台播放、上一台/下一台、暂停/继续、音量、失败自动重试与切台
- 迷你播放器（常驻底部）+ 全屏播放面板
- 媒体会话（锁屏/控制中心/媒体键）+ iOS 后台播放
- 收藏（本地）+ 最近播放
- 设置：只显示 HTTPS、隐藏疑似电视/离线台、清空数据、关于（数据来源署名）
- 三端适配：iPhone 单列、iPad/macOS 宽窗两栏、Web 响应式

### 1.4 明确不做（一期）

| 不做 | 原因 |
| --- | --- |
| 账号 / 跨设备同步 | 需要后端 + 隐私政策，MVP 用本地收藏即可（数据模型预留 `stationuuid` 同步能力） |
| "正在播放的歌曲"（ICY StreamTitle） | Web 端受 CORS/自定义头限制，原生需自写解析；二期走代理或原生模块 |
| 节目表（EPG） | 目录没有 |
| 录音 / 定时录制 / 转播 | 版权风险 |
| 自建电台目录 / 提交电台 | 用官方 `/json/add` 的形式二期再说 |
| 广告 / 内购 | Exact 无 SDK 生态；若商业化需重估框架 |
| Android / Windows | Exact 上分别"早期可用/半成品"，不进一期（数据层与 UI 已平台无关，后续成本低） |

### 1.5 成功标准（可验证）

| 指标 | 目标 |
| --- | --- |
| Web 首屏可交互 | < 1.5 s（3G Fast） |
| iOS 冷启动到可点击 | < 1 s（Exact 官方口径 p50 100 ms） |
| 点击电台到出声 | < 2.5 s（p50），失败率 < 5%（热门前 200 台） |
| iOS 后台播放 30 分钟不掉 | 100% |
| 锁屏/控制中心/媒体键 | 三端全部可用 |
| 崩溃/白屏 | 0（一期无第三方崩溃上报，靠 agent 回归 + 手工矩阵） |

---

## 2. 信息架构与三端布局

### 2.1 导航结构

```
[routes nav]
  tab  discover  "/"            → 发现（热门/最近/国家/语言/标签）
       tag        "/tag/:tag"
       country    "/country/:code"
  tab  search    "/search"      → 搜索 + 筛选
  tab  radio     "/radio"       → 收音机（模拟调谐盘，转旋钮随机换台）
  tab  favorites "/favorites"   → 收藏 / 最近播放
  notfound

  常驻层（不属于路由）：
    迷你播放器   —— 路由之上、tab bar 之上的一个 absolute 盒子
    播放面板     —— 点迷你播放器展开的全屏覆盖层（absolute inset=0）
```

**关键决定：播放面板不做成路由。** 理由：
- 播放面板要能从任意 tab 打开、且不能打断用户当前所在的 tab 栈；做成路由就要为每个 tab 复制一份子路由，或者在打开时 `open()` 换栈，前者冗余后者会丢失浏览位置。
- Exact 支持"路由之后写的兄弟节点覆盖在所有平台的原生控件和 tab bar 之上"，这正是播放面板需要的层级。
- 代价：`/station/:uuid` 深链没有。一期不分享单台，只分享"标签页/国家页"（这些有 SEO 价值），可以接受。二期若要分享单台，再加一条根级路由 + 面板里"复制链接"。

### 2.2 三端布局

| 端 | 布局 |
| --- | --- |
| iPhone | 单列；原生 tab bar（3 个）；迷你播放器贴在 tab bar 上方（`bottom: calc(49px + env(safe-area-inset-bottom))`）；播放面板全屏上滑 |
| iPad / macOS 宽窗 | 两栏：左列表（320–380 px）右详情/播放器；`responsive-columns` 或宽窗判定后切两栏；tab bar 变侧栏（Exact 在宽窗自动处理） |
| Web 桌面 | 三栏可选：左导航（tab 保留在顶部即可）+ 中列表 + 右"正在播放"固定面板；宽度 < 720 px 退化为单列 |
| Web 移动 | 同 iPhone，迷你播放器 + 面板 |

### 2.3 视觉与声音的"平台感"

- 不写死颜色：用语义角色（`-exact-secondary-label`、`-exact-secondary-background`、`-exact-separator`、`AccentColor`），自动跟随深色模式与系统强调色。
- 字号用 `font="-exact-headline"` 等系统字号，跟随 Dynamic Type。
- 列表用 `list`（iOS 得到原生 cell 的滑动/长按菜单），行内自绘即可。
- 图标：Exact 有 SF Symbols 映射（`icon=`）；跨端缺失时用内置 SVG。

---

## 3. 技术架构

### 3.1 文件布局

```
radio/                             ← exact new 生成的 app 目录
  app.contract                     ← 界面/状态/交互（本项目最大文件，按需拆 .contract 成员文件）
  app.ts                           ← 数据模块：网络、SQLite、规范化、缓存
  app.json                         ← 清单：bundle id、audio_session、ATS、窗口、图标、部署
  app.test.contract                ← 契约测试
  seed/
    popular.json                   ← 随包种子：热门 200 台（每周更新）
    facets.json                    ← 随包种子：国家/语言/标签词表
  assets/
    icon.png                       ← ≥1024 方形
    placeholder-*.png              ← 3 档占位封面（可选，也可纯色块+首字）
  .ci/                             ← EAS 构建脚本（若要云端构建）
```

> `.contract` 可以拆多个文件并用 `import "./partials/player.contract"` 组合；建议按「播放器 / 列表 / 筛选」拆三块，避免单文件过大（`contract build` 的错误定位更清晰）。

### 3.2 分层与数据流

```
        ┌──────────────────────── app.contract（view/state/action）─────────────────────────┐
        │  发现    搜索    收藏    mini player    player sheet    settings                   │
        └───────────────────────────────┬───────────────────────────────────────────────────┘
                                        │ resource / mutation（参数 + revision 触发重读）
        ┌───────────────────────────────▼───────────────────────────────────────────────────┐
        │  app.ts（Hermes / 浏览器）                                                          │
        │  ┌────────────┬──────────────┬──────────────┬───────────────┬──────────────────┐  │
        │  │ server.ts  │ api.ts       │ normalize.ts │ store.ts      │ cache.ts         │  │
        │  │ 服务器发现 │ 端点封装     │ 数据清洗     │ SQLite/文件   │ 内存 + TTL 缓存   │  │
        │  └────────────┴──────────────┴──────────────┴───────────────┴──────────────────┘  │
        └───────────────────────────────┬───────────────────────────────────────────────────┘
                                        │ fetch（需 grants）
                        ┌───────────────▼────────────────┐
                        │ de1.api.radio-browser.info      │
                        └────────────────────────────────┘

        音频路径独立：audio 元素的 src=url_resolved → 电台服务器（不经 app.ts、不需 grant）
```

**两条路径必须分开理解**：
- **元数据**走 `app.ts` 的 `fetch`，需要 grant，会被 CORS/ATS 约束，可缓存、可重试。
- **音频**走 `audio` 元素，直接连流服务器，不需要 grant，但受混合内容、ATS、编解码支持约束。

这是 Exact 上一个容易踩的坑：改 `url_resolved` 后音频能放，不代表 `app.ts` 能 fetch 那个地址（反之亦然）。

### 3.3 app.ts 的对外契约（Contract 只认这几个 source）

```ts
export const grants = `
  net.fetch https://de1.api.radio-browser.info
  net.fetch https://all.api.radio-browser.info
  sqlite.open app:/data/radio.db
`;
```

| source | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `discover` | `{ feed: string, cursor: number, rev: number }` | `{ items: Station[], hasNext: bool }` | `feed` ∈ `top`/`recent`/`country`/`language`/`tag`，cursor 是 offset |
| `search` | `{ q, country, language, tag, codec, minBitrate, cursor, rev }` | `{ items, hasNext, total? }` | 防抖后调用，limit 40 |
| `facets` | `{ kind: string, q: string }` | `{ items: Facet[] }` | 国家/语言/标签词表，带本地缓存 |
| `favorites` | `{ rev: number }` | `Station[]` | 从 SQLite 读，返回时按 `sort_order` 排序 |
| `history` | `{ limit: number, rev: number }` | `HistoryEntry[]` | 最近播放 100 条 |
| `setFavorite` | `{ station, on: bool }` | `{ count: number }` | 写 SQLite；`on=false` 时删除 |
| `recordPlay` | `{ station }` | `{ ok: bool }` | 写历史 + 发 `/json/url/{uuid}` 计 click（失败不影响播放） |
| `refreshStations` | `{ uuids: string[] }` | `Station[]` | 启动时刷新收藏的流地址（防链接腐烂） |
| `settings` | `{}` | `Settings` | 读取设置（也可用 `state … persist`，见 5.2） |
| `saveSettings` | `Settings` | `{ ok: bool }` | 写设置 |

**约定**：
- 所有 source 都**不读时钟**（Exact 数据模块禁止 `clock`），需要「今天」的参数一律由 Contract 传 `now`/`today` 进去。
- 所有网络 source 内部有 8 s 超时 + 1 次重试 + 服务器切换；对上层只抛/只返回「空 + 错误标记」，保证 UI 永远有东西可渲染。
- 返回体只含**渲染需要的最小字段**（见 3.4 的 Station），不要把 raw 100 KB JSON 塞给 plan。

### 3.4 Station 类型（客户端视图模型，不是 raw）

```ts
type Station = {
  id: string;            // stationuuid
  name: string;          // 已 trim、已去描述尾巴
  stream: string;        // url_resolved（优先）；http 原样保留，加 hls 标记
  secure: boolean;       // stream 是 https
  hls: boolean;
  favicon: string;       // 仅 https 且可解析；否则 ""
  country: string;       // "China"
  countryCode: string;   // "CN"
  language: string;      // "chinese"
  tags: string[];        // 最多 4 个，去掉噪声标签
  codec: string;         // "MP3" | "AAC" | "AAC+" | "OGG" | ""
  bitrate: number;       // 0 表示未知
  health: number;        // lastcheckok 0/1
  votes: number;
  clicks: number;
};
```

规范化（`normalize.ts`）规则——每条都要有单测：

| 规则 | 输入 → 输出 |
| --- | --- |
| 名字清洗 | `" 0R - PIANO JAZZ LOUNGE \|\| Jazz, Piano"` → `"0R - PIANO JAZZ LOUNGE"`（按 `\|\|`、` - ` 后接长描述、连续空白切分，保留 ≤ 60 字符） |
| 空名兜底 | 空 → `"未命名电台"`（并按国家/标签补一个副标题） |
| 疑似电视过滤 | `hls=1 && codec=="UNKNOWN" && bitrate>=600` → 默认隐藏（设置里可开） |
| 重复折叠 | `(name.toLowerCase(), host(stream))` 相同 → 保留 votes 高者 |
| 图标 | 非 https 或无图标 → `""`（UI 用首字 + hash 取色占位） |
| 码率 | 0 → 显示"未知"，不参与排序 |
| 标签 | 去掉 `radio`、`music`、`online` 等泛词，最多 4 个 |
| 健康 | `lastcheckok=0` → 显示"可能离线"角标，默认沉底 |

---

## 4. 数据层设计

### 4.1 服务器发现（第一个模块，必须健壮）

```ts
// server.ts —— 伪代码
let cached: { host: string, at: number } | null = null;

async function baseUrl(now: number): Promise<string> {
  if (cached && now - cached.at < 60_000) return cached.host;
  // 1) 配置里的候选（构建期注入，避免硬编码单台）
  // 2) DNS: all.api.radio-browser.info / SRV _api._tcp.radio-browser.info
  //    原生端有 DNS 能力就用；web 端拿不到，直接跳过
  // 3) 兜底：GET https://de1.api.radio-browser.info/json/servers
  // 打乱顺序，逐个 /json/stats 探活（2 s 超时），第一个成功的即为 host
}
```

要点：
- **随机化 + 失败切换 + 60 s 缓存**，三件事缺一不可。官方明确要求不要硬编码单台。
- 探活用 `/json/stats`（轻量）而不是 `/json/stations`。
- 失败时向上抛 `{ ok:false, reason }`，UI 显示"数据源不可用，重试"而不是空白。
- 因为 web 端无法做 DNS 与自定义 UA，**web 的服务器发现退化为候选列表 + `/json/servers`**。

### 4.2 端点映射（UI 需求 → API）

| UI | 端点 | 参数 |
| --- | --- | --- |
| 今日热门 | `/json/stations/search` | `order=clickcount&reverse=true&hidebroken=true&limit=40&offset=cursor` |
| 最近被点播 | `/json/stations/lastclick` | 取 40 条后本地过滤 |
| 按国家 | `/json/stations/search` | `countrycode=CN&order=votes&reverse=true&limit=40` |
| 按语言 | `/json/stations/search` | `language=chinese&order=clickcount&reverse=true` |
| 按标签 | `/json/stations/search` | `tag=jazz&tagExact=true&order=clickcount&reverse=true` |
| 搜索名称 | `/json/stations/search` | `name=<q>&order=clickcount&reverse=true&hidebroken=true` |
| 筛选词表 | `/json/countries` `/json/languages` `/json/tags` | 本地缓存 24 h |
| 收藏刷新 | `/json/stations/byuuid` | `uuids=a,b,c`（一次 ≤ 50） |
| 计点击 | `/json/url/{uuid}` | 点播时发一次 |

### 4.3 请求策略（决定"感觉快不快"）

| 策略 | 做法 |
| --- | --- |
| 首屏 | **不等网络**：先渲染随包种子 `seed/popular.json`（200 台），后台再拉真实热门榜覆盖 |
| 分页 | `limit=40`，滚动到 80% 触发下一页；`hasNext=false` 后停止 |
| 防抖 | 搜索 350 ms gated task（`task search when draft != applied` + `after(350, apply)`） |
| 去重 | 同一 (q, filters, cursor) 的进行中请求复用，避免重复打 |
| 缓存 | 内存 Map：`search:*` 30 s、`facets:*` 24 h、`station:<uuid>` 5 min；容量上限 200 条 LRU |
| 超时/重试 | 8 s 超时；网络类错误重试 1 次（换服务器）；4xx 不重试 |
| 并发 | 同时最多 2 个 stations 请求（Exact 的 fetch 并发无限制，但目录服务器不欢迎突发流量） |

> 目录服务器 ~1 s 冷启动延迟是现实：**首屏必须靠种子数据，不能靠网络**。这是这个 App 体验的第一决定因素。

### 4.4 点击上报（合规 + 回馈）

- 每次用户点播：`GET /json/url/{uuid}`，**不阻塞播放**（fire-and-forget mutation，失败静默）。
- 同 IP 同台每天只记一次，所以不需要客户端去重。
- 在"关于"页写明："播放数据通过 radio-browser.info 公开 API 获取；点播会按官方要求回传计数。"

### 4.5 种子数据（随包）

- `seed/popular.json`：热门前 200 台（约 250 KB），带 `fetchedAt`。
- `seed/facets.json`：国家（224）、语言（583）、标签（取前 500），约 60 KB。
- 更新方式：`tools/refresh-seed.ts`（CI 每周一跑或手动），产出 diff 提 PR —— **种子是构建产物，不是运行时数据**。
- 收益：断网/首启/目录抖动时 UI 仍然完整；也是 P0 之后立刻能看到进度的东西。

---

## 5. 持久化设计

### 5.1 SQLite（`app:/data/radio.db`）

```sql
CREATE TABLE IF NOT EXISTS favorites (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  stream      TEXT NOT NULL,
  favicon     TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  language    TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',      -- 逗号
  codec       TEXT NOT NULL DEFAULT '',
  bitrate     INTEGER NOT NULL DEFAULT 0,
  hls         INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL,              -- epoch ms
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  stream    TEXT NOT NULL,
  played_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS history_played ON history (played_at DESC);

CREATE TABLE IF NOT EXISTS recent_search (
  q   TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

规则：
- 历史保留最近 200 条，写入时 `DELETE FROM history WHERE id NOT IN (SELECT id … LIMIT 200)`。
- 打开数据库要**串行**（Exact 文件锁，一个队列）：模块级 `let dbPromise`。
- 整数从 SQLite 出来是 `bigint`，一律 `Number()` 后再返回（否则 plan 里比较会出错）。
- 迁移：`meta.schema = "1"`，启动时检查，后续加列走 `ALTER TABLE`。
- bake 期无存储：捕获 `'bake'` 错误返回空数据（官方明确要求）。

### 5.2 设置用 `state … persist`

`state volume = 0.8 persist`、`state onlyHttps = false persist`、`state hideSuspect = true persist`、`state sleepMinutes = 0 persist`。
注意 persist 只存**值**，不存记录——结构化的东西（收藏、历史）必须走 SQLite/文件。

---

## 6. Contract 结构（骨架，示意）

> 下面代码用于说明结构与绑定关系，最终语法以 `bun exact.mjs contract build --json --errors-only` 为准。

### 6.1 路由与根组件

```contract
routes nav
  tab discover "/"
    tag "/tag/:tag"
    country "/country/:code"
  tab search "/search"
  tab favorites "/favorites"
  notfound

component App
  state volume = 0.8 persist
  state onlyHttps = false persist
  state hideSuspect = true persist
  state expanded = false
  state wantPlay = false           // 用户意图：是否应该出声
  state currentId = "" persist
  state currentName = "" persist
  state currentStream = "" persist
  state currentFavicon = "" persist
  state playerStatus = "idle"      // idle|loading|playing|paused|failed
  state playerError = ""
  state retries = 0
  state sleepDeadline = 0
  state now = 0                    // 由每秒 task 推进，所有时间计算都用它

  derive searching = nav.tab == "search"
  derive cur = top(nav)
  derive showPlayer = currentId != ""
  derive sleepLeft = sleepDeadline - now

  resource station = loadStation(currentId) when currentId != "" as shape Station else empty()
  mutation playStation = startPlay(uuid, now) refreshes station then act
  mutation bump = tick(now)                    // 用「写后重读」驱动时间类 derive
  ...
```

**实现注意**：

- `playerStatus` 用**字符串常量 + derive** 表达，不要依赖未确认的联合类型语法（P0 里验证一次）。
- 播放器状态机的输入来自 `audio` 元素事件，动作里只做**赋值**，不做异步；异步全部在 `app.ts`。
- `now` 用 `task clock when true` + `every(1000, tick)` 推进（睡眠定时器、时长显示都要它）；测试里可 `clock +600000` 快进。

### 6.2 播放器元素（根级，唯一实例）

```contract
  view
    ...routes 容器...
    if showPlayer
      MiniPlayer(...)
    if expanded
      PlayerSheet(...)
    audio currentStream paused=(wantPlay == false)
      testId="player"
      metadata=MediaMetadata(
        title=currentName,
        artist=currentCountry,
        album="",
        artwork=currentArtwork)
      previoustrack=nextStation
      nexttrack=nextStation
      stop=stopPlay
      wakelock=(playerStatus == "playing" ? "screen" : "none")
      playing=onPlaying waiting=onWaiting error=onError pause=onPause
```

关键点：
- **只绑 `previoustrack`/`nexttrack`/`stop`**，不绑 seek（直播流没有可 seek 的时间轴；绑了锁屏会出现无意义的进度条）。
- `metadata` 的四个字段必须都给；`artwork` 传 https URL 或本地 asset（本地占位图更稳，因为 39% 无图标）。
- **`paused` 只由 `wantPlay`（用户意图）驱动**，不直接由事件驱动。`playing/waiting/pause` 事件只更新 `playerStatus`/`buffering` 用于显示——否则"切台瞬间源还没加载，pause 事件会把状态改回去"，会出现按钮自己跳的抖动。
- `wakelock="screen"` 只在播放时申请。
- 元素必须在根组件、且**始终挂载**（不要放进 `if` 里），否则切 tab 会重建、断流。

### 6.3 列表与分页

```contract
component StationList
  props items: Station[], hasNext: bool
  action loadMore
    cursor = cursor + 40
  view
    list virtualized=true reachend=loadMore reach-margin="100%" estimated-item-height=72
      for s in items key=s.id
        StationRow(station=s, active=(s.id == currentId))
      if hasNext
        row
          text "加载中…" font="-exact-footnote" color="-exact-secondary-label"
```

加载行必须是 `for` 的最后一个子元素（官方 recipe 明确要求，不能是兄弟节点），否则虚拟列表的 reachend 行为会错。

### 6.4 播放动作（单个 action 串起"选台 → 播放 → 记账"）

```contract
  action selectStation(s: Station)
    currentId = s.id
    currentName = s.name
    currentStream = s.stream
    currentFavicon = s.favicon
    playerStatus = "loading"
    playerError = ""
    retries = 0
    wantPlay = true
    expanded = true
    recordPlay(s)          // mutation，写历史 + 计 click，不阻塞

  action onError(code: string)
    if retries < 2 && retryable(code)
      retries = retries + 1
      after(retryDelay(retries), retryLoad)   // retryLoad 里 load("player")
    else
      playerStatus = "failed"
      playerError = code
```

错误处理表（`code` 来自 Exact 稳定错误码）：

| code | 含义 | 处理 | 文案 |
| --- | --- | --- | --- |
| `network` | 连接失败/超时/被拦截（含 http 混合内容） | 重试 2 次（1 s、3 s），仍失败切下一台 | "连不上这个电台，已换台" |
| `aborted` | 主动中断（切台时常见） | 忽略 | — |
| `decode` | 编码不支持（OGG 在 Apple、异常流） | 不重试，切下一台 | "本设备不支持该编码" |
| `src-not-supported` | HLS 在 web / 空 URL | 不重试 | "网页版无法播放 HLS 直播流" |
| `not-allowed` | 浏览器自动播放策略 | 停在"点击播放" | "点一下播放按钮开始" |
| `invalid-value` | URL 非法 | 不重试 | "该电台地址无效" |

**自动切台**要限次数（一次用户点击最多自动切 3 台），否则会在"全部不可用"时疯狂跳转。

### 6.5 迷你播放器 与 播放面板

迷你播放器（高 56 px，贴在 tab bar 上沿）：
`[favicon 36px] 电台名 / 国家·码率          [♥] [▶/❚❚]`

播放面板（全屏，`position="absolute" inset=0`，背景 `-exact-background` + 模糊/深色）：
```
[﹀ 收起]                    [⋯ 更多]
        [大封面 240px / 占位]
        电台名（2 行截断）
        国家 · 语言 · 码率 · 编码
        [标签 chips]
   [⏮]      [▶/❚❚ 大按钮]      [⏭]
        [🔊 音量滑块（web/macOS）]
        [⏱ 睡眠定时 15/30/60 分钟]
        如果 failed：错误横幅 + [重试] + [换一台]
```

### 6.6 睡眠定时器

```contract
  action setSleep(minutes: number)
    sleepDeadline = (minutes == 0 ? 0 : now + minutes * 60000)
  task sleepTicker when sleepDeadline > 0
    every(1000, checkSleep)
  action checkSleep
    if sleepDeadline > 0 && now >= sleepDeadline
      sleepDeadline = 0
      wantPlay = false
      playerStatus = "paused"
```

可测：`clock +1800000` 后断言 `playerStatus == "paused"`。

---

## 7. 跨平台差异矩阵（逐条给出处理策略）

| 差异 | Web | iOS | macOS | 处理 |
| --- | --- | --- | --- | --- |
| http 流 | 被混合内容拦截 | 需 ATS 放宽 | 需 ATS 放宽 | 提供"只显示 HTTPS"开关（默认关）；遇到 http 失败时文案说明；二期 Worker 代理 |
| HLS | Chrome/Firefox 不支持 | 支持 | 支持 | `hls=1` 行加角标；web 上失败文案明确 |
| OGG | Chrome 支持，Safari 不支持 | 不支持 | 不支持 | 失败自动切台 + 角标 |
| 后台播放 | 页面在前台/后台标签页都出声，切到后台标签可能被节流 | 需 `backgroundModes: ["audio"]` | 天然支持 | 清单配置，见 §8 |
| 锁屏控制 | 浏览器媒体中心（Chrome/Safari） | 锁屏 + 控制中心 | 菜单栏/媒体键 | `metadata=` + 3 个 action |
| 自动播放策略 | 首次必须用户手势 | 无限制 | 无限制 | 不在加载时自动播放；"继续收听"需点击 |
| 音量 | 元素音量可调 | 元素音量可调（系统音量优先） | 可调 | 面板里给滑块，web/macOS 显示 |
| 安全区 | `env(safe-area-inset-*)` | 同 | 窗口标题栏 | `viewport-fit="cover"` + 统一 padding |
| 键盘 | — | — | ⌘←/→ 切台、空格播放 | `keyboard` 快捷键（macOS） |
| 分享 | Web Share / 复制链接 | 系统分享 | 系统分享 | 分享"标签页/国家页"URL |

**一个必须承认的现实**：这个 App 在三个平台上的**电台可用率不同**（https+HLS+MP3 的台三端都能放；http+OGG 的台只有部分能放）。产品上要**提前说明**，而不是让用户遇到神秘的失败。

---

## 8. app.json 清单要点

```json
{
  "name": "Radio",
  "app": { "id": "com.yourname.radio", "name": "Radio" },
  "audio_session": "playback",
  "icons": [{ "src": "assets/icon.png", "sizes": "1024x1024", "purpose": "maskable" }],
  "host": {
    "ios": {
      "backgroundModes": ["audio"],
      "appTransportSecurity": { "allowsArbitraryLoads": true }
    },
    "macos": {
      "appTransportSecurity": { "allowsArbitraryLoads": true },
      "window": {
        "width": 1180, "height": 800,
        "minWidth": 900, "minHeight": 600,
        "keepRunning": true
      }
    }
  }
}
```

（已按 `.research/app.schema.json` 校对：`name` 与 `app.id/name` 必填；`audio_session` 只接受 `ambient|playback|playback-mix`；`backgroundModes` 会拒绝 `remote-notification|fetch|processing`；iOS 分发要求 ≥1024 px 方形 maskable 图标。）

必须逐项确认的三件事（P0 一起验）：

1. `audio_session: "playback"` —— 否则 iPhone 静音键一拨就没声，且永远不会成为 Now Playing。
2. `host.ios.backgroundModes: ["audio"]` —— 否则锁屏即停。**两者都缺一个，`ios` build 会直接拒绝**。
3. `appTransportSecurity.allowsArbitraryLoads: true` —— 才能播 35% 的 http 台；App Store 审核要在"备注"里写理由（"用户订阅的部分电台仅提供 HTTP 流"）。若审核被拒，备选方案是 Worker 代理（见 §12）。

另外白送一个 macOS 体验点：`host.macos.window.keepRunning: true` 让用户按 ⌘W 关窗后电台继续播、点 Dock 图标原样回来（⌘Q 才退出）——对"办公时当背景声"的场景非常合适。**注意**：开着这个，就不要再写"关闭即退出"的常规预期。

必须逐项确认的三件事（P0 一起验）：

1. `audio_session: "playback"` —— 否则 iPhone 静音键一拨就没声，且永远不会成为 Now Playing。
2. `host.ios.backgroundModes: ["audio"]` —— 否则锁屏即停。**两者都缺一个，`ios` build 会直接拒绝**。
3. `appTransportSecurity.allowsArbitraryLoads: true` —— 才能播 35% 的 http 台；App Store 审核要在"备注"里写理由（"用户订阅的部分电台仅提供 HTTP 流"）。若审核被拒，备选方案是 Worker 代理（见 §12）。

---

## 9. 里程碑与任务分解

### P0 — 技术验证（3 天，**go/no-go**）

目标：用 300 行以内验证风险，不做 UI 抛光。

| # | 任务 | 验收 |
| --- | --- | --- |
| 0.1 | 安装工具链（Rust/Bun/Chrome/Xcode），`exact new radio`，三端跑通 hello | `web`/`mac --run`/`ios --run` 都能起 |
| 0.2 | 写"探针 app"：一个 `audio` + 6 个硬编码电台 | 见下表 |
| 0.3 | 验证 6 类流在三端的表现 | 记录成功/失败/错误码/首声时间 |
| 0.4 | 验证后台 + 锁屏 + 媒体键（iOS 真机优先） | 锁屏 30 min 不断、封面/标题正确、上/下一首可用 |
| 0.5 | 验证 `app.ts` 直连 radio-browser（含自定义 UA、CORS、延迟） | 拿到 200 条数据，延迟记录 |
| 0.6 | 验证 `load(id)` 重试、`error` 码稳定性、`not-allowed` 触发条件 | 每种码至少触发一次 |
| 0.7 | 测量：web 首屏、iOS 冷启动、`web-build` 体积 | 数字记录，与 §1.5 对比 |
| 0.8 | 验证清单：ATS 开关是否影响音频、AirPlay、`state.mediaSession` 读取 | 结论写进 P0 报告 |

**探针矩阵（6 类流 × 3 端）**：

| 类型 | 样本 | 关注 |
| --- | --- | --- |
| https + MP3 | 主流台（占 64.7%） | 基线 |
| http + MP3 | 老式台 | ATS / 混合内容 |
| https + AAC | 常见 | 兼容 |
| https + OGG | 少量 | Apple 预期失败 → 错误码是不是 `decode` |
| https + HLS | 5.8% | web 预期失败 → 是不是 `src-not-supported` |
| https + 重定向到 http | 混合 | ATS 下的行为 |

**P0 的 go/no-go 判据**（全部满足才继续 Exact）：

- ≥ 5/6 类流在三端能放（失败类必须是"预期失败 + 明确错误码"）
- iOS 后台 30 分钟不断，锁屏信息正确
- web 首屏 < 2 s，`web-build` 体积 < 500 KB
- `app.ts` → radio-browser 在 web 与原生都能通

**不满足则退路**：React Native + `react-native-track-player`（iOS/macOS）+ 独立 Next.js Web，数据层（`normalize.ts`/`server.ts`/`api.ts` 的纯 TS 部分）可 100% 复用——这也是为什么数据层要写成**与框架无关的纯 TS**。

**P0 产出**：`.research/p0-report.md`，含每类流的实测截图/日志/错误码/首声时间。

### P1 — 骨架（4 天）

| # | 任务 | 验收 |
| --- | --- | --- |
| 1.1 | `app.ts`：`server.ts` 服务器发现 + `api.ts` + `normalize.ts` + 单测（纯 TS，可用 `bun test` 跑） | 2000 条样本清洗后无空名/无重复 |
| 1.2 | Contract：3 tab 路由 + 空列表 + 骨架屏 | 三端导航一致，web URL 正确 |
| 1.3 | 发现页：热门榜单（种子优先 + 网络覆盖）+ 分页 | 滚动到底加载下一页，无重复项 |
| 1.4 | 搜索页：输入 + 防抖 + 结果列表 | 输入 350 ms 后才发请求；清空恢复 |
| 1.5 | 播放器：选台 → audio 播放 + 迷你播放器 + 状态机 | 三端点击即播，暂停/继续正确 |
| 1.6 | 媒体会话：metadata + 上一台/下一台/stop | iOS 锁屏显示正确，媒体键可用 |
| 1.7 | 收藏：SQLite 写入/读取 + ♥ 状态 | 重启后收藏仍在，三端一致 |

### P2 — 完成度（5 天）

| # | 任务 | 验收 |
| --- | --- | --- |
| 2.1 | 筛选：国家/语言/标签/码率/仅 HTTPS | 组合筛选结果正确，参数进 URL（可分享） |
| 2.2 | 播放面板（全屏）：封面、标签、音量、睡眠定时 | 三端布局正确，安全区正确 |
| 2.3 | 错误处理：错误码 → 文案 + 重试 + 自动切台 + 限次 | 拔网/切 http 台/HLS 台均有正确提示 |
| 2.4 | 历史 + 最近搜索 | 三端持久化 |
| 2.5 | 宽窗两栏（iPad/macOS/Web ≥ 1024） | 列表 + 详情并排，窄窗自动退化 |
| 2.6 | 设置页 + 关于（数据来源、许可、版本） | 三项开关生效，关于页文案准确 |
| 2.7 | 无障碍：aria-label、动态字号、键盘操作（macOS） | `agent` 的 a11y 检查通过 |
| 2.8 | 视觉打磨：占位封面、加载态、空态、深色模式 | 无裸 spinner、无空屏 |

### P3 — 发布（3 天）

| # | 任务 | 验收 |
| --- | --- | --- |
| 3.1 | 图标（≥1024）、启动图、About 文案 | `ios --archive` 不因图标报错 |
| 3.2 | web 构建 + 托管（Cloudflare Pages / 任意静态） | 三端线上可访问，深链可用 |
| 3.3 | macOS：`exact release` 签名 + 公证 | 双击可开，无"未知开发者" |
| 3.4 | iOS：`--archive out.ipa` → TestFlight → 审核（含 ATS 说明） | 审核通过 |
| 3.5 | 隐私政策页（无账号、无埋点、本地存储说明） | 与实现一致 |
| 3.6 | 回归矩阵（见 §10.3） | 全绿 |

### P4 — 二期（可选，不在本期承诺）

- Worker 代理：http→https、ICY now-playing、统一 UA（解决 Web 端 35% 不可播 + 无 now-playing）
- 单台分享深链 `/station/:uuid`
- iCloud/自建同步收藏
- 导出 M3U / 导入 M3U
- 车载（CarPlay 需要 entitlement，评估后再定）

---

## 10. 测试与质量

### 10.1 三层测试

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 纯逻辑 | `bun test`（`normalize.ts`/`server.ts`/`api.ts` 是纯 TS，不依赖 Exact） | 清洗规则、去重、URL 选择、查询参数拼装、分页游标 |
| 界面契约 | `app.test.contract` + `bun exact.mjs test` | 选台→状态流转、收藏切换、睡眠定时（`clock` 快进）、错误码分支 |
| 端到端 | `scripts/agent.mjs`（tree/tap/state/screenshot） | 三端真实点击、锁屏信息（`state.mediaSession`）、截图回归 |

### 10.2 关键契约测试（写死在 P1）

```contract
test "selecting a station starts playback"
  tap "station-row-2"
  expect state playerStatus == "loading"
  expect state currentName != ""
  clock +3000
  expect state playerStatus == "playing"
```

```contract
test "sleep timer pauses after the deadline"
  tap "station-row-1"
  tap "sleep-15"
  clock +900000
  expect state playerStatus == "paused"
  expect state sleepDeadline == 0
```

### 10.3 手工回归矩阵（发布前）

| 场景 | Web | iOS | macOS |
| --- | --- | --- | --- |
| 首启无网络 → 种子数据可见 | ✅ | ✅ | ✅ |
| 点击热门第 1 台出声 | | | |
| 锁屏/切后台 30 min | — | | — |
| 媒体键上/下一首 | — | — | |
| 收藏 → 杀进程 → 重启仍在 | | | |
| 播放中滚动列表 300 项不卡 | | | |
| 深链 `/tag/jazz` 直达 | | — | — |
| 窗口从 1400 拖到 400 宽 | | | |
| 深色模式 / 动态字号最大 | | | |

---

## 11. 发布与运维

| 端 | 方式 | 成本 |
| --- | --- | --- |
| Web | `bun exact.mjs web-build --out dist` → 任意静态托管（Cloudflare Pages / Vercel / OSS+CDN） | 0 |
| iOS | `ios --archive out.ipa` 本地或 EAS（`.eas/build/eas-ios.yml`）→ TestFlight → App Store | $99/年 |
| macOS | `exact release`（Developer ID 签名 + 公证）→ 官网/DMG 或 Mac App Store | $99/年（同一账号） |

运维要点：
- **种子数据每周更新**（热门榜会漂移），CI 里跑 `tools/refresh-seed.ts` 提 PR。
- **流地址会腐烂**：收藏列表每次启动 `byuuid` 刷一次最新 `url_resolved`；失败时保留旧值并标记。
- **目录服务器变化**：每季度跑一次 `tools/check-api.ts`（端点/字段/CORS/延迟），失败就发版。
- **Exact 升级**：锁 `EXACT_REF` commit，每季度评估一次升级；升级前跑全量 `verify` + 3 端回归。

---

## 12. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| R1 | Exact pre-1.0，升级破坏 API | 高 | 中 | 锁 commit；数据层与框架解耦（纯 TS）；季度升级窗口 |
| R2 | iOS 审核因 ATS 放宽被质疑 | 中 | 高 | 审核备注写清理由；备选 Worker 代理；或默认先不发 iOS |
| R3 | Web 端 35% http 台不可播，用户觉得"坏" | 高 | 中 | 默认只播 https（开关可改）；失败文案明确指向 App |
| R4 | HLS/OGG 在部分端不可播 | 确定 | 低 | 角标 + 自动切台 + 文案 |
| R5 | radio-browser 服务不可用/限流 | 中 | 中 | 种子数据 + 缓存 + 服务器切换 + 降级 UI |
| R6 | 数据脏导致体验差 | 高 | 中 | `normalize.ts` + 单测 + 默认隐藏低质条目 |
| R7 | 无现在播放信息，产品显得"空" | 确定 | 低 | 用"国家/语言/码率/标签"填满信息位；二期代理 |
| R8 | Contract 学习曲线拖慢进度 | 中 | 中 | P0 只写 300 行探针；先用 `pattern tabs`/`list-detail` 生成骨架 |
| R9 | 无崩溃/分析，线上问题不可见 | 中 | 中 | `logs` + 自建上报端点（二期）；发布前密集手工回归 |
| R10 | macOS 公证/签名流程踩坑 | 中 | 低 | P3 预留 1 天；先用 `--unsigned` 内测 |

---

## 13. 决策记录（ADR 摘要）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 是否用 Exact | 用，但先过 P0 | 功能面匹配、三端一码；风险用验证关卡兜住 |
| 播放面板是否路由 | 否，根级覆盖层 | 跨 tab 打开、不破坏栈；代价是单台深链 |
| 收藏存储 | SQLite | 需要排序/计数/去重与原子写；JSON 在并发下易坏 |
| 设置存储 | `state … persist` | 都是标量，最短路径 |
| 首屏数据 | 随包种子 + 网络覆盖 | 目录 1 s 冷延迟不可接受 |
| 搜索分页 | limit 40 + offset | 目录支持 offset；比 cursor 简单可靠 |
| 是否自建后端 | 一期不做 | CORS 已开、无需鉴权、无账号 |
| 自动播放 | 不自动 | 浏览器策略 + 用户预期 |
| 媒体会话 action | 只绑 prev/next/stop | 直播无可 seek 时间轴 |

---

## 14. 待你确认（影响排期与验收）

1. **平台优先级**：Web / iOS / macOS 是否同等重要？如果 Web 只是"顺手做"，http 流与 HLS 的降级可以更激进，iOS 优先。
2. **是否接受 iOS 关闭 ATS**？接受 → 一期就能播 http 台；不接受 → 一期 iOS 只播 https（约 65%），http 台等二期代理。
3. **是否要账号/跨设备同步**？要 → 需要后端（+3 周）与隐私政策；不要 → 纯本地。
4. **是否商业化**（广告/订阅/内购）？要 → Exact 没有 SDK 生态，需要重新评估框架，越早知道越好。
5. **App 名称 / bundle id / 图标**：现在给我，或者先用 `Radio` / `com.yourname.radio` 占位。
6. **UI 语言**：只中文？中英双语（i18n）？目录数据本身是英文为主（国家/语言/标签），双语要额外做映射表。
7. **是否现在就开工 P0**？我可以直接从 `exact new` 开始，3 天后给你 P0 报告 + 是否继续的建议。

---

## 附录 A：Contract 速查（本项目会用到）

```contract
// 声明
shape S { id: string, n: number, on: bool }
fn fmt(bps: number): string = bps == 0 ? "未知" : `${bps} kbps`

component C
  state on = false persist
  derive label = on ? "开" : "关"
  resource items = load(q) as shape S[] else empty()
  mutation save = put(x) refreshes items then act
  task timer when on key=on
    every(1000, tick)
  action toggle
    on = !on
  view
    column gap=12 padding=16
      for it in items key=it.id
        row gap=8
          text it.id
      if pending(items)
        text "加载中…"
```

- 值不可变：`concat`、`Shape(old, f=v)`；没有 `push`/`sort`（用 `sortBy`）。
- 没有 truthiness：写 `x != ""`；空用 `option` + `match`。
- 字符串模板用反引号；注释用 `//`。
- `testId=` 是测试与 a11y 的抓手。

## 附录 B：radio-browser 端点速查

```
GET /json/stations/search?name=&countrycode=&language=&tag=&tagExact=&codec=
    &bitrateMin=&bitrateMax=&is_https=&order=&reverse=&offset=&limit=&hidebroken=
GET /json/stations/topclick/100        GET /json/stations/topvote/100
GET /json/stations/lastclick           GET /json/stations/byuuid?uuids=a,b,c
GET /json/tags          /json/countries         /json/languages        /json/codecs
GET /json/url/{uuid}    ← 点播计数（必须）      GET /json/stats         /json/servers
```
