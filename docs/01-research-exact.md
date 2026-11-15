# 调研一：Exact（expo/exact）框架能力评估

> 调研时间：2026-11-15。仓库：<https://github.com/expo/exact>（MIT，2026-11-02 建仓，约 4.1k stars，约 212 MB，主力语言 Rust）。
> 本地留档：`.research/exact-docs/`（start-here、contract-for-agents、contract-for-humans、contract-grammar、reference、agent-pitfalls，以及 6 个 recipe）。

## 1. 它到底是什么

一句话：**用一套声明式 UI 语言（Contract）写界面，用 TypeScript 写数据逻辑，编译成 plan，再用各平台原生渲染器执行**。没有 React，没有 JSX，UI 层不跑 JavaScript，App 启动时**首帧之前不执行你的 JS**。

- `app.contract`：界面 + 状态 + 交互（`.contract` 是一门 TypeScript 子集的语言）
- `app.ts`：数据模块（`async answer(source, args, store, storage, native)`），跑在 Hermes（Apple/Android）或浏览器
- `app.json`：清单（bundle id、权限、audio session、ATS、窗口尺寸、图标、部署）
- 宿主：Web（plan → 约 20 KB ES module，操作真实 DOM/CSS）、macOS（AppKit，非 SwiftUI）、iOS（UIKit，模拟器 + 真机）、Linux（GPU/CPU 绘制）。Android 早期可用，Windows 半成品。

官方给出的 v1 门槛是「一个真实应用（Caltrain 列车时刻）用同一份 Contract 跑在 web / macOS / iOS / Linux 四端」，这条已经达成。[README](https://github.com/expo/exact#readme)

### 三条设计原则

1. **Agent native**：内置 10 个操作 `tree / screenshot / tap / type / state / layout / logs / clock / prefer / perf`，`scripts/agent.mjs` 可以跨 web、macOS、iOS（模拟器或真机）、Linux 驱动应用。这意味着 AI/CI 能直接验证界面，而不只是跑单测。
2. **速度**：冷启动可交互首帧 100 ms p50、dev 重启 100 ms p50、改一行编译 crate 30 s、全量阻塞检查 65 s。
3. **Write the web, ship the platform**：CSS 语义做布局，平台原生控件接管"平台感"（iOS 的列表滑动删除、导航栏、sheet 手势、macOS 的菜单/工具栏），未明确指定的外观交给平台。

### 工具链与工作流（实测文档结论）

| 项 | 要求 / 命令 |
| --- | --- |
| 工具链 | Rust（rustup，仓库内 `rust-toolchain.toml` 固定版本）、Bun 1.4.2、Google Chrome、Xcode 27.1+；Windows 需 WSL2 |
| 一次性安装 | `bun scripts/exact.mjs setup`（含 Hermes 的 pinned bundle `260318099.0.4`） |
| 新建 App | `bun scripts/exact.mjs new <path> --name … --bundle-id … --with ios` |
| 开发 | `bun exact.mjs web` / `bun exact.mjs ios --run` / `bun exact.mjs mac --run` |
| 校验 | `bun exact.mjs verify`（全平台）、`verify ios`、`verify web` |
| 测试 | `bun exact.mjs test`（`app.test.contract`，可 `clock +60000` 快进） |
| CI 门禁 | `bun exact.mjs contract build app.contract --json --errors-only` → 输出 `[]` 且退出码 0 |
| 类型/语法 | `contract types app.contract -o app.contract.d.ts`、`contract vocab`、`contract migrate` |
| 发布 | `ios --release --archive out.ipa --json`、`exact release`（Mac 签名+公证）、`web-build --out dist` + `serve dist` |
| 分发 | `scripts/deploy.mjs` 发布 web 根目录与签名更新包；`share`（AppDrop 真机安装链接） |

**注意**：没有打包好的 CLI，必须从源码 checkout 工作（`exact new` 生成的 app 用路径引用它）。

## 2. 语言与结构速览（写计划必须知道的约束）

- **值不可变**：`Shape(old, field=新值)`、`xs.concat([x])`，没有 `push`。
- **没有 truthiness**：必须 `x != ""`、`x != 0`；可空用 option：`none` / `some(v)` / `match`。
- **没有 `sort`**：用 `sortBy(xs, f)`。
- **`==` 按值比较**；数字字面量不能有前导零（`08` 非法）。
- **action 内的赋值在 action 结束时才提交**，同一 action 后续行读到的仍是旧值——写"读改写"要小心。
- **resource 必须有形状**：`resource r = load(a) as shape T[] else empty()`；`pending(r) / failed(r) / failure(r) / current(r)`。
- **mutation + refreshes**：`mutation m as shape R refreshes r then act`，是"写后重读"的官方姿势。
- **路由即 URL**：`routes nav` + `tab`，web 上 Back/刷新/分享天然可用；`push` 靠 `nav = go(nav, url)`，`path("station", id)` 造路径，`link href=`。
- **列表分页**：`list virtualized=true reachend=loadMore reach-margin="100%"`，官方 recipe 里 `app.ts` 负责 append，`hasNext` 收尾。
- **防抖**：用 gated task，`task search when draft != applied key=draft` + `after(350, apply)`（官方给的正是 debounce 例子）。
- **持久化**：`state x = 0 persist`（只存值，不存记录）；大结构走 `storage.fs`（JSON 文件）或 `storage.sqlite`（web 是浏览器 SQLite）；密钥走 `store`（Keychain / localStorage）。
- **能力声明**：`export const grants = '…'`，一行一个，比如 `net.fetch https://de1.api.radio-browser.info`、`sqlite.open app:/data/radio.db`。**运行时 fetch 没有 grant 会直接拒绝**。
- **构建期常量**：`import.meta.env.API_BASE_URL`，在 `app.json` 的 `env` 里声明。
- **随包数据**：`import seed from './seed.json'`，和 `app.ts` 一起打进包，不需要 grant、不需要路径——非常适合做首屏离线数据。

## 3. 对"网络电台 App"最关键的音频能力

### 3.1 `audio` 元素 = HTML 的 `<audio>`

```contract
audio current.url paused=paused timeupdate=ticked
  metadata=MediaMetadata(title=current.name, artist=current.country, album="", artwork=current.artwork)
  previoustrack=prev nexttrack=next stop=stop
  play=hostPlaying playing=hostPlaying pause=hostPaused error=playerError waiting=buffering
```

- `src` 可以是 https URL、`app:/data/…` 本地文件；**媒体加载不走 `net.fetch` 授权**（只有数据模块的 `fetch` 需要 grant），所以任何 https 流都能放。
- 支持事件：`play / playing / pause / ended / waiting / seeking / seeked / ratechange / volumechange / timeupdate / durationchange / error / loadedmetadata / canplay`。
- `error` 会给**稳定错误码**（不是引擎原文）：`aborted`、`network`、`decode`、`src-not-supported`、`not-allowed`、`invalid-value` —— 这就是我们做"失败自动切台/重试"的依据。
- 方法：`fastSeek(id, seconds)`、`load(id)`（重试同一 URL 用 `load`，因为绑定同一个 `src` 不会重新加载）。
- 有 `volume`、`muted` 属性；`controls` 会渲染平台原生控件（电台 App 一般自己画）。

### 3.2 iOS 的三条硬性要求

1. `app.json` 里 **`"audio_session": "playback"`**。默认是 `ambient`：会遵守静音键（iPhone 静音模式下**完全没声**），而且不能进 Now Playing。
2. **`host.ios.backgroundModes: ["audio"]`**。没有它，锁屏瞬间音频就停。
3. 声明了 `metadata=`（媒体会话）却没有上面两项，**iOS build 会直接拒绝**。

`playback-mix` 是给节拍器/玩具用的（mixWithOthers，不打断别的 App），它**永远不能成为 Now Playing**，电台不能用。

### 3.3 锁屏 / 控制中心 / 媒体键

`metadata=MediaMetadata(title=, artist=, album=, artwork=)` + 六个 action：`seekbackward / seekforward / seekto / previoustrack / nexttrack / stop`。

- 每个字段都要写（没有就 `""`）；`artwork` 一张图，https URL 或本地 asset。
- 只绑定你绑定的按钮：不绑 `seekbackward` 锁屏就不显示快退按钮。**直播流绑上一首/下一首/stop 即可，不要绑 seek**。
- 一个元素持有会话：最近开始播放的那个，暂停后仍持有。
- 实测状态可从 `state.mediaSession` 读到（`owner / metadata / actions / playbackState / published / artworkError`），测试里 `expect mediasession title == …`。
- Mac 的上/下一曲键发 `previoustrack`/`nexttrack`。

### 3.4 已知边界（对电台产品来说是真限制）

| 限制 | 影响 | 结论 |
| --- | --- | --- |
| Apple 端播放器不播 OGG/Vorbis（AVFoundation 不支持） | 约 0.9% 电台 | 显示"本设备不支持"，自动跳下一台 |
| Web 端 `audio` 不支持 HLS（Chrome/Firefox 不会播 `.m3u8`） | 5.8%（热门样本 10.3%） | web 端对 `hls=1` 做降级提示；Safari 例外 |
| Web 页是 https 时，http 音频被混合内容规则拦截 | 约 35% 电台 | MVP：web 端只显示 https 台；二期：Worker 代理 |
| 无法读 ICY 的 `StreamTitle`（web 因 CORS 与自定义头；原生可做但要自写解析） | 没有"正在播放的歌曲" | MVP 不做，二期走代理/原生模块 |
| 没有 AirPlay 路由选择器 API | 依赖系统 AVPlayer 默认行为 | P0 验证项 |
| 没有任何三方 SDK 生态（分析、崩溃、推送、内购、广告） | 商业化受限 | 若要变现，重新评估框架 |
| pre-1.0，每天在变，无迁移指南 | 升级有成本 | 锁 commit，季度升级，锁定用法 |

## 4. 网络与 ATS（决定了能不能播 http 台）

- 数据模块 `fetch` 需要 grant，origin 级：`net.fetch https://de1.api.radio-browser.info`；要访问任意用户自填服务器就写 `net.fetch https:`（整个 scheme）。
- **iOS/macOS 的明文 http**：默认 ATS 拒绝任何 http。只有"本地网络 + `host.ios.localNetworking`"才放行。要让 App 播 http 流，必须：

```json
"host": {
  "ios":   { "appTransportSecurity": { "allowsArbitraryLoads": true } },
  "macos": { "appTransportSecurity": { "allowsArbitraryLoads": true } }
}
```

  这是**全 App 生效**（含 iframe），App Store 审核要求说明理由。对电台 App 的理由是成立的："用户订阅的电台中相当一部分只提供 HTTP 流"。
- 只放宽 webview 的 `allowsArbitraryLoadsInWebContent` 对我们**没用**（音频不是 webview）。
- Web 端开发期可以给 Chrome 加 `--unsafely-treat-insecure-origin-as-secure=<origin>` 来测 http 流，但生产 https 站点无法绕过。

## 5. 与同类方案对比（诚实版）

| 方案 | 适合度 | 说明 |
| --- | --- | --- |
| **Exact** | 适合，但有学习成本 | 一套 Contract 三端原生；音频/媒体键/后台播放都覆盖；无生态、pre-1.0、语言新 |
| React Native + Expo | 最稳 | 生态成熟（`react-native-track-player` 直接解决后台/锁屏/重试），但要写 JS 业务 + 原生依赖，包体大，web 端要另做 |
| Flutter | 稳 | 三端 UI 一致，`just_audio` + `audio_service` 成熟；macOS 桌面体验一般 |
| SwiftUI + 独立 Web | 平台感最好 | 三套代码，成本最高 |
| Tauri + Web 前端 | Web 复用最好 | 桌面端好，iOS 仍需 WebView，后台音频/锁屏体验差 |

**结论**：这个 App 的功能面（长音频流 + 列表搜索 + 媒体键 + 收藏）正好落在 Exact 已实现的范围内，且 Exact 的"agent 可驱动"对后续维护是加分项。风险不在功能，而在**框架成熟度**——所以计划里把"P0 技术验证"设为 go/no-go 关卡，而不是直接开工。

## 6. 官方示例里值得抄的

- `apps/caltrain`：旗舰应用，四端跑，路由/列表/实时数据/响应式都能参考。
- `apps/video-player`：媒体元素 + 媒体会话最完整的示例（含 `app.test.contract`）。
- `apps/realworld`：搜索、分页、路由参数、登录态。
- `apps/fieldnotes`：本地 SQLite/文件持久化、搜索防抖、`state … persist`、备份导入导出。
- `docs/patterns/tabs`：原生 tab + 每 tab 独立栈；`appearance="none"` 可自绘 tab bar（我们要在 tab bar 上方放 mini player，用这个）。
- `docs/recipes/long-lists.md`：分页列表标准写法。
- `docs/recipes/shipped-data.md`：随包 JSON 数据。
- `docs/recipes/mobile-build.md` / `eas-ios.md` / `website.md`：三端发布。

> ⚠️ 两个容易误会的示例：`apps/listen-fixture` 是 **unix socket** 监听 fixture，`apps/stream-fixture` 是 **H.264 视频帧流** fixture，都和网络电台无关。
