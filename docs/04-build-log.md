# 实现记录（Build log）

记录 Airwave 从脚手架到跑通的过程：环境怎么搭、Contract 的哪些写法是编译器认可的、数据层怎么接、验证到哪一步。

## 1. 环境

沙箱只能写工作区，Exact 的 setup 要往 `~/.cache/exact`、`~/.rustup` 写东西，所以先把工具状态目录全部重定向进仓库：

```sh
# .tools/env.sh（source 一次即可）
export WORKSPACE=/Users/lizhuo/owork/e-asr
export EXACT=$WORKSPACE/.extern/exact        # expo/exact 浅克隆
export BUN_INSTALL=$WORKSPACE/.tools/bun     # Bun 1.4.4（仓库要求 >=1.4.2）
export CARGO_HOME=$WORKSPACE/.tools/cargo
export RUSTUP_HOME=$WORKSPACE/.tools/rustup
export HOME=$WORKSPACE/.tools/home           # setup 写 ~/.cache/exact 需要
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

- 仓库 `rust-toolchain.toml` 固定 1.97.0，本机是 1.97.1；不用覆盖，直接 `rustup toolchain install 1.97.0 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown` 装进工作区。
- app 内 `exact.mjs` 认 `EXACT` 环境变量，所以 SDK 放在 `.extern/exact`、app 放在 `airwave/` 也能解析。
- `bun exact.mjs setup --check` 无需全绿：web 与 contract 只要求 Bun；iOS 需要 Xcode 27+（本机 27.2 已装）。

## 2. 建 app

```sh
cd .extern/exact
bun scripts/exact.mjs new ../airwave --name Airwave --bundle-id com.lizhuo.airwave --with ios
mv ../airwave /Users/lizhuo/owork/e-asr/airwave
```

`app.json` 的关键项（用 `.research/app.schema.json` 校对过）：

- `audio_session: "playback"` —— iOS 默认 `ambient` 在静音键开启时不出声，锁屏也不显示 Now Playing。
- `host.ios.backgroundModes: ["audio"]` —— 后台继续播。
- `host.macos.window.keepRunning: true` —— ⌘W 关窗继续播，点 Dock 回来。
- 不写 `appTransportSecurity` —— 只播 https，不去申请 ATS 例外。

## 3. Contract 语法：编译器教我的那些

这些是实际报错逼出来的，写别的 Exact app 也会遇到：

| 现象 | 正确写法 |
| --- | --- |
| `resource x = src(a) as shape T[] else empty() when cond` 报 `expected end of line, found when` | `when` 在 `as` 之前：`resource x = src(a) when cond as shape T[] else empty()` |
| `audio source s.stream` 报 unknown attribute `source` | 属性名是 `src`：`audio src=s.stream` |
| `lower-route-place`：路由不在导航根下 | 路由节点必须是导航根的子节点，或挂在**被 tab 按钮 `aria-controls` 指到的** `role="tabpanel"` 下 |
| `section` has no attribute `header` | 小节标题写成 `section` 的子节点 `header` |
| `symbol` 不是 role | 只认固定角色集（`bun exact.mjs contract vocab symbol`）；`dot.radiowaves…`、`chevron-down`、`magnifyingglass` 都不是，分别用 `radio`、文字按钮、`search` |
| `answer` 返回 `unknown` 不匹配 `TypeScriptAnswer` | `import type { Answer, Sources } from './app.contract.d.ts'`，`const sources: Sources = {…}`，`export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native)` |
| `storage.fs.readFile()` 当 `Uint8Array` 用 | 它返回 `Promise<ArrayBuffer>`；`atomicWriteFile(path, Uint8Array)` |
| mutation 的 reply 少字段 | 每个 `mutation … as shape R` 的 source 都要返回完整的 `R` |
| 条件渲染的覆盖层被别的元素盖住 | DOM 顺序决定层级：覆盖层要放在同层最后（面板从 `main` 子节点挪进内容列末尾后，按钮才点得到） |

其它有用的事实：

- 输入框不会自动提交，要 `submit=commit`；但更稳的是用 gated task 做防抖：
  `task liveSearch when draft.trim() != applied` + `after(450, commit)`。
- 键盘步骤的键名不是 `Enter`（driver 报 `unsupported key "Enter"`），所以测试里用 `clock +600` 等防抖，而不是按键。
- 宽窗口下 tab 自动变成左侧边栏（原生 tab 容器行为），不用自己写响应式。

## 4. 数据层（app.ts）

- 服务器发现：先 `de1`，失败换 `all.api.radio-browser.info`，每次请求带 `Airwave/0.1` User-Agent；`exactTimeout: 8000`。
- 只要 https 流（`is_https=true` 服务端过滤 + 客户端再校验一次），并排除 `hls=1`（Web 的 `<audio>` 播不了 HLS）。
- `url_resolved` 优先（playlist 与跳转已解析）。
- 名字清洗：去掉 `||` 之后的体裁粘连、压空白、超 72 字截断加省略号。
- 国家名缩写：`The United Kingdom Of Great Britain And Northern Ireland` → `UK`，`The United States Of America` → `USA` 等（榜单里这两个最常出现，一行放不下）。
- 收藏/最近收听存 `app:/data/*.json`（`fs.read`/`fs.write` grant），最近收听去重后最多 20 条。
- 每次点播 `fetch /json/url/{uuid}` 计一次 click（radio-browser 唯一的礼节要求）。
- `bake` 期（构建视图时）没有网络与存储：读文件失败返回空数组，写失败吞掉 `bake` 错误。

## 5. 验证

```sh
cd airwave
bun exact.mjs web-build            # 静态站 → target/web-dist
bun exact.mjs test web             # 4 passed
bun exact.mjs agent web --storage airwave-dev "clock data" "..."
bun exact.mjs mac --run
bun exact.mjs ios --run
```

- Web：列表、搜索（防抖后提交）、标签/国家路由、收藏落盘、播放面板、Media Session 元数据都已按截图核对（`.research/shots/`）。
- `state mediaSession` 在点播后为 `playbackState: "playing"`、`actions: ["nexttrack","pause","play","previoustrack"]`、`published: "navigator.mediaSession"`。
- macOS / iOS 的构建结果见下一节。

## 6. 已知边界（与计划一致）

- http 台不展示（占索引约 35%），也不申请 ATS 例外。
- HLS 台（约 6–10%）在 Web 上播不了，当前直接从列表剔除。
- 未做：分页/无限滚动、搜索历史、音量与睡眠定时器、按语言/编码筛选、iCloud 同步。

## 7. 三端构建：让 exact 在这台机器上跑起来

exact 是 pre-1.0、每天在变的框架，`bun exact.mjs mac` / `ios` 在受限环境里各撞了 2–3 个墙，全部在本地 SDK（`.extern/exact`）打补丁解决。**升级 exact 后这些补丁会被覆盖，需要复查。**

| 症状 | 根因 | 补丁 |
| --- | --- | --- |
| `swift package … describe` 报 `sandbox-exec: sandbox_apply: Operation not permitted` | SwiftPM 自己再套一层沙箱，被外层沙箱拒绝 | `scripts/app.mjs` 的 describe 与 `host/apple/build.mjs` 的 build/test 命令加 `--disable-sandbox` |
| `xcrun … metal … unable to open output file '…/ModuleCache/…pcm'` | Metal 前端把模块缓存写到 `$TMPDIR`/用户缓存，落到工作区外 | `canvas/vello/build.rs` 与 `host/apple/svg-filter.mjs` 给 metal 传 `-fmodules-cache-path=<工作区内目录>`（必须是 `=` 连写的单个参数） |
| `can't find crate for core` / iOS target 缺失 | `.tools/env.sh` 里 `RUSTUP_TOOLCHAIN=stable` 指向没有 iOS target 的 1.100.0，而 SDK 固定 1.97.0 | 环境变量改成 `RUSTUP_TOOLCHAIN=1.97.0` |
| `agent ios` 报 `Unable to establish FIFO at ~/Library/Developer/CoreSimulator/…` | simctl 要在用户 Library 下建 FIFO | 用完整文件权限运行（本会话 `danger-full-access`） |

`.tools/env.sh` 里另外把 `HOME`、`CARGO_HOME`、`RUSTUP_HOME`、`CLANG_MODULE_CACHE_PATH`、`SWIFT_MODULE_CACHE_PATH`、`TMPDIR` 全部重定向进工作区，否则 setup/构建会去写 `~/.cache`、`~/.cargo`。

构建产物：

- macOS `airwave/target/clients/<hash>/com.lizhuo.airwave/macos/Airwave.app`（ad-hoc 签名，`bun exact.mjs agent macos …` 可直接驱动）
- iOS 模拟器 `…/ios-simulator/aarch64-apple-ios-sim/embedded/development/standalone/Airwave.app`（`xcrun simctl install/launch`，`agent ios --sim "iPhone 17"` 驱动）
- Web `target/web-dist`（`bun exact.mjs serve dist` 或任意静态托管）

## 8. 跨端布局：三条端各自教了一课

**（1）tab 栏必须自己画。** `role="tablist"` 交给平台画时，macOS 上图标与文字并排挤在左下角，iOS 上变成悬浮玻璃胶囊、内容从它下面穿过。改成 recipe 里的 app-drawn 变体（`appearance="none"` + 绝对定位 + 自己在按钮里排图标和文字）后三端一致。

**（2）DOM 顺序就是层级。** 播放条与面板都用 `position="absolute"`，谁在后面谁盖住谁。面板最初排在 tab 栏之前，被 tab 栏压在下面（`tap player-save` 报 `button covers its middle`）；移到 `main` 最后一个子节点后就对了。

**（3）iOS 的原生容器会盖住兄弟节点。** `role="tabpanel"` 在 Apple 端是平台视图，把它当兄弟的面板画不出来 —— 面板即使有 400 个节点、`layout` 也能查到尺寸，屏幕上仍是列表。面板必须挂到 `main` 下（tabpanel 的祖先之外）。

**（4）`viewport-fit="cover"` 是 macOS 的雷。** iOS 上不写 cover，`env(safe-area-inset-*)` 全是 0，tab 按钮被压到 17pt、图标被裁；写了 cover，iOS 正常，但 macOS 整窗白屏（数据、布局、tree 都正常，只是画不出来）。最后放弃 cover，改用固定 56pt 的 tab 栏 + 固定 104pt 的播放间隙，三端都能看。面板的顶部留白同理：`env(safe-area-inset-top)` 在面板里解析成 0，直接写 88。

## 9. 当前状态与下一步

- 已验证：三端构建 + 数据加载 + 搜索 + 标签/国家路由 + 收藏落盘 + 播放（Media Session 报告 `playing`，macOS 与 iOS 都能播）+ 播放面板；Web 侧 4 个 `app.test.contract` 用例通过。
- 下一步（按 `docs/03-plan.md` 的 P2）：列表分页/无限滚动、搜索历史、音量与睡眠定时器、按语言/编码筛选、失败流的自动跳过与重试退避、图标与 App Store 素材、iOS 真机签名（`DEVELOPMENT_TEAM`）与 Mac 公证（`bun exact.mjs release`）。

## 10. 收尾时的布局定稿（写进代码的规则）

- **内容列居中**：每条 route 的 column 是 `position="absolute" inset=0` + `max-width="47.5rem"`（760pt）+ `margin-left/right="auto"` + `width="100%"` + 条件 `padding-bottom`（播放中 104 / 其余 56）。窄窗时 100% 生效，宽窗时居中，三端同一套。
- **底栏两层都是绝对定位**：tab 栏 `position="absolute" left=0 right=0 bottom=0 height=56 justify-content="center"`，三个按钮 `flex=1 max-width="12rem"`；播放条 `bottom="calc(56px)"`。tab 栏用自绘（`appearance="none"`），不再交给平台。
- **面板三层**：`column testId="player-panel"`（absolute inset=0，铺满并盖住底栏）→ 内层 `column flex=1 max-width="47.5rem" width="100%" box-sizing="border-box" margin auto`（居中；`box-sizing` 不能少，否则 iOS 上右侧按钮被裁）→ 顶部 `padding-top=88`、底部 `calc(72px + env(safe-area-inset-bottom))`。
- **面板必须是 `main` 的最后一个子节点**（在 tab 栏之后），否则 iOS 的 tabpanel 原生视图会压在它上面。
- `max-width` 用 `rem` 写（`47.5rem`、`12rem`），用 px 会触发 `lower-text-px-width` 警告（Dynamic Type 下文字可能溢出）。
- 还剩 2 条无害警告 `lower-list-beside-fixed`（第 156/162 行的 chips carousel 悬在滚动列表上方），iOS 上列表会从胶囊下面滚过并带模糊边 —— 这是平台原生观感，先留着。

## 11. P2 增量（2026-11-15 第二轮）

- **分页**：`app.ts` 里每个 `(kind, value, query)` 一条 feed，`feed(kind, value, query, want)` 返回累计到 `want` 条的整表；视图侧 `state want = 40`，`action loadMore` 加一页，列表尾部一支「加载更多」。坑：翻页用索引的**原始** offset，而列表里已按「只留 https / 非 HLS / 去重」过滤过，所以 `page.rows.length` 不能拿来判断「没有下一页」——要单独记 `raw`（`pageOf` 返回 `{rows, raw}`），短页才代表到底。
- **没有无限滚动**：`reachend` 只属于 `virtualized=true` 且「一个直接 `for`」的列表，我们的列表带 section/header，编译期就报 `lower-collection-edge`；`intersect=` 是 Web 专有。三端一致的做法是列表尾部一支显式按钮。
- **搜索历史**：`app:/data/searches.json`，去重前置、最多 8 条；`commit` 里 `send recorded = pushSearch(applied)`，mutation 声明 `refreshes history`。空查询时把历史做成胶囊，点一下回填并提交。
- **睡眠定时**：`state sleepLeft`（秒）+ `task sleepTick when sleepLeft > 0` + `every(1000, tickSleep)`；到 0 时 `wantPlay=false`、`status="idle"`、收起面板。注意 action 里的赋值在动作结束才提交，所以判断写 `sleepLeft <= 1`（读到的仍是旧值）。停止/换台时 `sleepLeft = 0`。
- **音量**：`input type="range" value=volume input=setVolume min=0 max=1 step=0.05` —— range 的 payload 是数字，`setVolume(v)` 直接收。
- **失败态**：重试旁边加「换一个」（复用 `nextStation`，从最近收听里挑下一个不同的台）。
- **图标**：`assets/icon.png` 1024×1024，`purpose: "any maskable"`；PIL 画的「电台波」标记（深蓝渐变 + 金色圆点 + 三道弧），Web manifest 与 Apple 端都从这一张取。

## 12. 随机模式：模拟收音机（2026-11-15 第三轮）

用户要的："随机模式，页面是一个模拟收音机的 ui，手动换台随机切换电台"。

- **第四个 tab**：`tab radio "/radio"`，图标 `symbol:radio`（发现页换成 `sparkles`），底部四等分（`max-width="12rem"` + tablist `justify-content="center"`）。
- **调谐盘用 `svg` 画，指针用 `view` 旋转**：刻度是 `for i in dialTicks` 里的 `g transform=\`rotate(${i * 7.5 - 75} 130 130)\`` + `line`，指针是一支 3×240 的 `view`，靠 `rotate=\`${needleAngle}deg\`` + `transition="rotate 620ms ..."` 转动 —— 只有 `rotate`/`translate`/`scale`/`opacity` 是各端都能动画的属性，`left` 之类不行。指针的转轴在视图中心，所以做成「圆心 → 弧顶」的半支：下半截用一块与盘面同色的 `view` 盖住，再叠一个 28pt 的轴心圆盖住接缝（DOM 顺序 = 图层顺序）。
- **随机取台**：`app.ts` 的 `randomStation(rev, exclude)` 打 `/json/stations/search?order=random&hidebroken=true&is_https=true&limit=8`，挑一个不等于当前在播的。返回 `{ rev, station }`，`rev` 原样带回。
- **竞态**：resource 在参数变化后仍持有上一轮的数据，只靠「条件满足就锁台」会在慢网下锁到**上一台**。所以把 `rev` 塞进返回值，`task landing when tuning and pickedRev == dialRev` 才启动，`lockIn` 里再校验一次 `p.rev == dialRev`。
- **手感**：`tune` 先置 `tuning = true` 并 `dialRev + 1`，指针走 `sweep` 关键帧来回扫、LED 用 `blink` 闪，650ms 后 `lockIn` 落台并开播；6 秒没回音就 `stopTuning`，不让旋钮卡死。
- **频率**：`freqOf(uuid)` 对 uuid 做 FNV-1a 再映射到 87.5–107.5（0.1 步进），同一台每次都是同一个刻度，指针角度 `(f - 87.5) / 20 * 124 - 62`。
- **三端对齐**：macOS 的 `secondary-background` 是中性灰、web/iOS 接近白，所以喇叭孔用 `-exact-separator`（两种底色上都看得见）；iOS 的原生 button 不吃 `flex`，所以「换台 / 播放 / 收藏」都改成 `appearance="none"` 自绘按键（`row` + `height=44` + 边框），三端长得一样。
- 测试：`bun exact.mjs test web` 7 passed（把「三个 tab」改成四个，新增「调谐盘初始待机、点旋钮后 tuning=true / dialRev=1」）。

## 13. 上滑加载：从「按钮」改成 `reachend`（2026-11-15 第四轮）

用户反馈：macOS 上上滑加载更多不工作；并要把 app 改到 iOS 模拟器上跑。

- **为什么之前只有按钮**：`reachend` 只属于 `list virtualized=true` 且**一个直接 `for`** 的列表（`docs/reference.md` "Intersection visibility"、LLP 1010）；我们的列表带 `section`/header，编译期直接报 `lower-collection-edge`，所以 P2 先退成显式按钮。
- **踩过的坑（别重复）**：试图用 `intersect=` 标记做无限滚动。第一版是 `row height=1 intersect=loadMoreOnEntry intersect-margin="0px 0px 600px 0px"` + `for boundary in [list.length] key=boundary` 重挂（long-lists recipe 里「填满短页」的技巧）——结果**失控**：macOS 上 `discoverList.length` 涨到 560（14 页），web 上撞到我自己写的 400 上限。原因是每次 append 重挂都会重新投递一次 `isIntersecting: true`（布局还没稳，标记在 0,0）。去掉重挂只留 `intersect` 也一样：启动即 400 行。
- **现在的写法**：三个分页列表（发现 / 标签·国家 / 搜索）都是
  `list id=\`content-${e.id}\` testId=\`feed-${e.name}\` appearance="none" virtualized=true flex=1 min-height=0 estimated-item-height=64 reachend=loadMore reach-margin="60%"`，**列表只有一个直接 `for`**，行模板单根 `row`（`padding="6px 16px"` + `border-bottom`）。「热门电台」这种小节标题从 `section header` 提到列表外面，变成普通 `text`。
- **`appearance` 不能写 `auto`**：`appearance="auto" listStyle="plain" virtualized=true` 会报 `lower-grouped-list`（"a grouped list builds every row … it is never `virtualized`"），必须 `appearance="none"`。
- **按钮留着当兜底**：分页按钮移到列表下方（`load-more-discover` / `load-more-browse` / `load-more-search`），`loadMore` 里已经有 `if want < 400`。
- **验证**：web 上从列表行起手 `drag 0 -600` 一次就 `40 → 80`；iOS 模拟器 `tap feed-discover drag 0 -400` 连划五次 `40 → 80`（驱动回报 `native="scroll" scrolledBy=[0,400]`）；`#jazz` 标签页同样 `40 → 80` 且 `tagMore` 仍为 true。`bun exact.mjs test web` 7 passed。
- **驱动的边界**：macOS 上 `tap feed-discover drag …` 只是手势，驱动回报里没有 `scrolledBy`（AppKit 列表的真滚动要靠触控板/滚轮事件），所以 macOS 的 `reachend` 我无法用 `agent` 复现，只能靠真机滚一下确认；web/iOS 两条路径都已实测。
- **给列表加 `testId`**：`feed-${e.name}`。虚拟化列表的行不在窗口里时驱动抓不到，`tap feed-discover into <rowKey>` 可以按 key 把行带进窗口。
- **顺手修掉两处 `analyze-read-after-assign`**：`commit` 里 `applied = draft.trim()` 后立刻读 `applied` 去 `pushSearch`、`tickSleep` 里 `sleepLeft = sleepLeft - 1` 后立刻判断 —— 读到的都是动作开始前的值。改成先绑 `let next = …`、再赋值、再用 `next`。现在 `web-build` 的警告只剩 3 条 `lower-list-beside-fixed`（chips 悬在列表上方，iOS 会带模糊边滚过，是平台原生观感）。
- **跑起来的两个窗口**：macOS `Airwave.app`（`bun exact.mjs mac --run`）与 iOS 模拟器 iPhone 17（`bun exact.mjs ios --run`，截图 `.research/shots/i38.png`）。

## 14. UI/UX 重构（v2）

调研与规格写在 [05-ui-redesign.md](05-ui-redesign.md)。这里只记落地时踩到的点。

- **缩进即结构**：`main` 的直属子节点（迷你条、tab 栏、`audio`、播放面板）少缩进两格就会变成内容列的最后一个子节点 —— 表现是 tab 栏跳到屏幕顶部、内容跑到它下面。改层级一定要整块移动，不要只改缩进里的某一两行。
- **`spacer` 不是标签**：写 `view flex=1`。`audio` 的属性只有 `src/paused/volume/preload/metadata/play/pause/error/loadedmetadata/previous*/next*`；`seekbackwardOffset` 这类名字不存在，`error=` 接的是无参动作（`error=failed`），错误码从 `state errorCode` 读。
- **`match` 必须穷尽**：`match current` 少了 `case none` 会报 `contract-match-arms`；给 `case none` 一个 `column height=0` 即可。
- **`line-clamp` 在属性表里**（u32），列表行截两行用它；`white-space="nowrap"` 只是不换行。
- **`filter="blur()"` 只有 web 画**：用它做「封面当氛围层」在 macOS/iOS 上会露出未模糊的放大图（macOS 上是一条色带）。跨端一致的做法是中性渐变。
- **iOS 的 tab 栏画在内容之上**：铺满窗口的播放面板底部要留 76pt，否则睡眠定时那一行被系统栏切掉。
- 图标按钮要 `aria-label`，否则 `lower-button-unlabelled` 报警（12 条警告里 4 条是这么来的）。
- 重写后 `bun exact.mjs test web` 9 passed（新增：hero 卡推入 `/radio` 并返回、`查看全部` 推入 `/popular`）。

## 15. Liquid Glass（按 HIG 复核后）

复核报告在 [06-hig-review.md](06-hig-review.md)。实现层面的四条事实：

- **玻璃是功能层的事**：`backgroundMaterial="glass"` 在 iOS 26 是 `UIGlassEffect`、macOS 26 是 `NSGlassEffectView`，网页/Linux 退化成 `backdrop-filter`。取值 `ultra-thin|thin|regular|thick|glass|glass-clear|none`；文本多的表面（迷你条）用 `regular`，浮在内容上的导航用 `glass`。
- **`backgroundMaterial` 优先于 `backdrop-filter`**：两个都写是安全的 —— Apple 端走材质，网页端走 blur。`backdrop-filter` 只认 `blur()` 与 `saturate()` 两个函数。
- **macOS 的玻璃只采样父层子树**：玻璃节点必须是被覆盖内容的**直接兄弟**，否则材质里是空的。而且只有 `screenshot <png> window`（截窗口而不是截应用画布）才看得见材质。
- **`-exact-scroll-edge-effect` 只有 Apple 端实现**：网页构建会打 `style row scroll_edge_effect skipped by the web host: no CSS lowering` 警告，功能无影响，留它是为了 iOS/macOS 的边缘渐隐。
- 触控目标实测：`layout player-toggle` 从 `32×32` 改到 `44×44` 后达标；tab 按钮 `128×59`。

## 16. 播放面板改 sheet 路由（Contract 的路由模型）

Exact 的路由是「一种路由 = 一条」，名字由 kind 决定（`tab home "/"`、`popular "/popular"`），
同一个 kind 在别处再写一次会报 `route-duplicate`。所以**没有全局 sheet**：播放面板必须在每个 tab 里各有一条。

```contract
routes nav
  tab home "/"
    …
    nowHome "/now"
  tab search "/search"
    nowSearch "/search/now"
  tab favorites "/favorites"
    nowFavorites "/favorites/now"
```

- 共用一份视图：`else if e.name == "nowHome" or e.name == "nowSearch" or e.name == "nowFavorites"`。
- 模态标记绑在**每一条路由共用的那列**上，用表达式关掉：
  `navigationPresentation=(isNow ? "modal" : "")`、`navigationDetent=(isNow ? "large" : "")`；
  空串表示普通推入（`apps/shared-elements` 里就是这么写的）。
- 打开是 `go(nav, nav.tab == "search" ? "/search/now" : …)`，关闭是 `back(nav)`；`state expanded` 删掉，
  它原来承担的「有播放条时为路由多留 64pt」改由 `derive inNow = cur.name == "nowHome" or …` 判断。
- 三个坑：① 路由 kind 不能叫 `now`（内建函数名，报 `syntax-expected-string`）；
  ② 路由节点不能嵌在另一条路由节点里（`lower-route-place`），分支里的内容要写成普通容器；
  ③ sheet 里的内容列 `max-width` 要小于 macOS sheet 的宽度，否则左边被裁（34rem 才合适，47.5rem 会溢出）。
- 驱动能读到 `presented="sheet"` 与 sheet 的安全区，`tap`/`back` 会自动等 UIKit 完成转场。

## 17. 辅助功能实测（simctl）

```sh
xcrun simctl ui <udid> appearance dark
xcrun simctl ui <udid> increase_contrast enabled
xcrun simctl ui <udid> content_size accessibility-extra-large
xcrun simctl io <udid> screenshot shot.png
```
- Dynamic Type 到 AX 大号时 tab 栏标签溢出：`height=60` 改成 `min-height=60` + `padding="6px 6px"` 后，
  栏会随字号长高，图标与文字仍居中。
- `simctl` 没有 reduce_transparency 这个开关，那一项只能真机人工核。

## 18. 子页面统一走系统导航栏（不要再自绘返回）

`docs/contract-for-agents.md:2319-2320` 的规则：**一条路由的第一个子节点如果是 `header`，里面恰好有一个
`text role="heading"`、其后可有文字/控件**，平台就把整个 `header` 变成导航栏 —— iOS 上是带 liquid glass
返回胶囊和玻璃按钮的导航栏，Web 上是「← Back + 标题」，macOS 上是窗口工具栏。自绘返回按钮会与它重复。

```contract
else if e.name == "tag" or e.name == "country"
  header display="flex" align-items="center" gap=8 padding="8px 16px"
    text (e.name == "tag" ? `#${e.params.tag}` : e.params.code) role="heading"
    button press=loadMore aria-label="更多" testId="load-more-browse"
      display=((e.name == "tag" ? tagMore : countryMore) ? "flex" : "none")
      text "更多"
```

踩坑记录：
- heading 只写 `role="heading"`（不带 `aria-level`）就是**行内标题**；`aria-level=1` 会变成大标题。
- 导航栏按钮里不要放自绘胶囊（`row` + `backgroundMaterial`），否则整个 `header` 会退回页面内渲染，
  标题留在栏里、按钮掉到内容区（正好是这次修掉的 bug）。
- `button` 必须有自己的内容或尺寸，否则报 `lower-zero-size`。
- `pending()`/`failed()` 只接受**一个资源名**，不能塞三元表达式；用一个 `derive`（`derive tagLoading = pending(tagList) and tagList.length == 0`）再在视图里选。

## 19. 首次请求的 loading 态

列表首屏为空时先判 `pending` 再判 `failed`，最后才是「这里没有电台」：

```contract
if (e.name == "tag" ? tagList : countryList).length == 0
  if e.name == "tag" ? tagLoading : countryLoading
    column flex=1 align-items="center" justify-content="center" gap=12
      animation="pulse 1.2s ease-in-out infinite"
      image "symbol:radio" width=30 height=30 color="-exact-secondary-label"
      text "正在载入电台…" font="-exact-subheadline" color="-exact-secondary-label"
  else if e.name == "tag" ? tagBroken : countryBroken
    …
```

`keyframes pulse` 就是 `from opacity=0.45 / to opacity=1`；`animation=` 可以挂在 `column` 上，整块一起呼吸。

## 20. 去掉搜索 tab

搜索变成首页推入的普通路由（`search "/search"`），首页 header 右侧多一个玻璃圆钮（`open-search`）。
`useSearch()` 里从 `select(nav, "search")` 改成 `go(nav, "/search")`；`nowSearch` 那条 sheet 路由随之删除，
`expand` 只剩两个目标（`/now` 与 `/favorites/now`）。测试里的 `tap "tab-search"` 全部换成 `tap "open-search"`。

## 21. 三 tab：发现 / 正在播放 / 收藏（默认落在中间）

- `tab radio "/radio"` 现在是中间那个 tab，也是启动页。默认 tab 由 `task boot when not booted` +
  `after(1, bootRadio)` 选过去（`nav = select(nav, "radio")`）；**只在 `cur.name == "home"` 时切换**，
  否则 Web 上直接打开 `/tag/jazz` 这类深链会被拽回首页。
- 每个 tab 一条 now 路由（`nowHome "/now"`、`nowRadio "/radio/now"`、`nowFavorites "/favorites/now"`），
  `expand` 用 `nav.tab` 选 URL；迷你播放条在 `nav.tab == "radio"` 时 `display="none"`，
  因为那一屏本身就是播放界面。
- 收音机面板重做：外层玻璃卡（`backgroundMaterial="glass"` + `backdrop-filter` + 大圆角 + 投影）里放
  「FM + 状态灯 + 调谐盘 + 台名 + 频率 + 国家」，盘下只留三颗按钮 —— 收藏（玻璃圆 54）、
  播放/暂停（强调色圆 78）、换台（玻璃圆 54，等同 `tune`）。去掉了喇叭孔、旋钮、换台/播放文字按钮与提示行。
- 调谐盘的「屏幕」有自己的底色（`-exact-tertiary-background`），遮住指针下半截的那条 `view` 用同一色，
  否则在玻璃卡上会看到一条突兀的色带（macOS 上尤其明显）。
- 玻璃按钮在浅色背景上几乎看不见，给两侧圆钮加了 `-exact-glass-tint="rgba(120, 140, 175, 0.20)"`。

## 22. 发现页瘦身

- 删掉首页的「随机收听」hero 卡与右上角的随机收听圆钮（与「正在播放」tab 重复），只留搜索圆钮。
- 删掉整条 `popular "/popular"` 路由与 `action openPopular`，「正在流行」回到首页固定 5 条（不再有「查看全部」）。
- 于是「更多」按钮也跟着没了：列表靠 `reachend=loadMore` 自动续页，tag/country 页只保留标题。

## 23. 地球仪（Radar / Radio Garden 那一路的交互）

- **投影必须在 `app.ts` 里算**：Contract 没有 sin/cos，视图只负责把 `x/y/z` 摆成点。
  `project(lat, lon, centerLat, centerLon)` 是正交投影（`z > 0` 才在可见半球），
  `globeView()` 把陆地表和标记点一起投影成一个 `GlobeDot[]`（`k = -1` 是标记）。
- 陆地数据：Natural Earth 110m land 多边形 → 斐波那契球面撒点 + 点在多边形内 → 450 个点，
  存成 `land.json`（5.7KB），随 `app.ts` 打进包里，运行时零网络。
- 拖动用 pointer 事件，不需要额外的手势系统：
  `pointerdown=globeDown pointermove=globeMove pointerup=globeUp` + `touch-action="none"`；
  横向改经度（`-dx * 0.45`），纵向改纬度并夹在 ±72°，`wrapLon` 处理跨经线。
- 松手才查询：`globeUp` 只 `settleRev += 1`，`resource nearby = nearest(…) when settleRev > 0`，
  `task settle when … and nearby.length > 0` 再 `after(80, playNearby)` —— 拖动过程中一个请求都不发。
- **`geo_distance` 的单位是米**，不是公里：写 `8000` 只有 8km，几乎必然空结果。现在用
  `geo_distance: 3000000`（3000km）+ `limit: 40`，拿回来在 `app.ts` 里按结果自带的 `geo_distance` 升序排，
  再 `toStations()` 过滤，取第一个能播的。
- 随机换台要能转过去，`randomStation` 必须带 `has_geo_info: 'true'`，否则随机到的台没有坐标、
  地球不会动。
- 转动动画是任务驱动的补间：`spinTo(lat, lon)` 记起点终点，`task spinTick when spinning` 每 45ms
  调 `spinFrame`，14 帧 ease-out（`t = step/14; e = 1-(1-t)^2`），跨经线用 `nearestLon` 选近的那一边。
- 点数是 450 个绝对定位的小 `view`：拖动时每帧重算并重排。三端都能跑，但这是这个设计的上限；
  再密就要换成 `canvas` 或贴图。

## 24. 从点阵地球换成真地图（瓦片）

点阵地球只是「示意」：没有海岸线、没有地名、也没法缩放。换成普通的 slippy map —— 一组 256px 瓦片平铺，
数学仍然全部在 `app.ts`（Contract 没有三角/对数）：

```ts
lonToX(lon, scale) = (lon + 180) / 360 * scale
latToY(lat, scale) = (0.5 - ln((1+sin)/(1-sin)) / 4π) * scale     // Web Mercator
```

`mapView(lat, lon, zoom, markerLat, markerLon)` 返回 `{ tiles: [{k,url,left,top}], markerLeft, markerTop,
hasMarker, lonPerPx, latPerPx }`；视图只做两件事：`for t in map.tiles` 贴 `image t.url`，和把标记摆在
`markerLeft/markerTop`。拖动用 `lonPerPx`/`latPerPx` 换算，所以缩放后拖动手感一致。

**瓦片服务的选择**（都要能无 key 直接取图，且允许带归属使用）：

| 服务 | 结果 |
| --- | --- |
| CARTO basemaps（`basemaps.cartocdn.com/dark_all/…`） | 2024 起要 API key，返回的是「API KEY REQUIRED」水印图 |
| OpenStreetMap 标准瓦片 | 可用，浅色，重负载有使用政策限制 |
| Esri Canvas `World_Dark_Gray_Base` | **采用**：无 key、深灰、带国名标注，和这个深色界面最搭 |
| Esri `World_Light_Gray_Base` / `World_Imagery` | 也可用，换一行常量即可 |
| OpenTopoMap | 可用，地形风，太花 |

Esri 的 URL 顺序是 `{z}/{y}/{x}`（先 y 后 x），别写反。归属必须显示：
`地图 © Esri · HERE · Garmin · OpenStreetMap`（界面上就是地图下方那行小字）。

- 缩放：`state mapZoom`（1–8），两个玻璃圆钮 `zoom-in`/`zoom-out`，`state` 变了 `map` 资源会重算瓦片。
- 落点：松手 → `nearby` → `playNearby` 播最近的台，并把地图 `spinTo` 到该台坐标（标记落回中心），
  这样「所选点」与「真正在播的台」不会各在一处。
- 随机换台同样 `spinTo`，所以地球/地图会滑到新台的位置。
- 瓦片下载是 `image` 的普通 https 请求，`grants` 里不用额外声明（`image` 不属于 `net.fetch`）。

## 25. 地图铺满整屏

- 这一屏的路由列**不吃 `max-width`、也不留底部 padding**：`max-width=(e.name == "radio" ? "none" : "47.5rem")`、
  `padding-bottom=(e.name == "radio" ? "0px" : …)`，于是地图铺到窗口四边，浮动的 tab 胶囊直接压在图上。
- 瓦片层的大小不能问布局要：`app.ts` 里按 **1400×1400 的虚拟盒子**铺瓦片（`MAP_BOX`），视图把这个盒子
  `position="absolute" left="50%" top="50%" translate="-50% -50%"` 居中、外层 `overflow="hidden"` 裁掉多余部分。
  `translate` 的写法是 `-50% -50%`（空格分隔，逗号会报 `lower-attr-value`）。
- 地图上的控件不能靠系统材质：`backgroundMaterial` 在 web 上是另一套观感，所以放大/缩小、底部信息条统一用
  `background-color="rgba(16, 20, 26, 0.56)"` + `backdrop-filter="blur(26px) saturate(1.3)"`，文字用白色与
  `rgba(255,255,255,0.72)`，在任何底图上都够对比。
- 底部信息条 `max-width="36rem"` 居中，宽窗下不会拉成一整条；`bottom=104` 让开那颗浮动 tab 胶囊。
- 宽窗实测（1100×780）：地图满窗、信息条居中 36rem、缩放钮贴右边缘。

## 26. 地图铺进安全区、统一外观、换台 loading

**铺进安全区**：`-exact-safe-area` 只接受 `none` 或具体边（写 `auto` 会报
`lower-attr-value: expected text`），而它是路由级的静态属性，没法按路由条件开关。改用文档里的另一条路：
把这块内容整体往上拉一个安全区高度 —— `radio-face` 上 `margin-top="calc(-1 * var(--exact-safe-area-inset-top))"`。
`var(--exact-safe-area-inset-*)` 在路由内就是这一屏自己的安全区（状态栏 + 导航栏），比为负正好抵消
宿主的 clear，于是地图铺到状态栏下面；底边本来就没 padding，自然铺到底。

**统一外观**：之前地图用 Esri 的深灰底图，而整个 app 是浅色 —— 这是唯一一块深色区域，看着像 bug。
现在 `app.json` 加 `"userInterfaceStyle": "light"` 把 app 钉在浅色，底图也换成浅色的
`World_Street_Map`（有城市名、有颜色，能看清电台在哪个城市），地图上的玻璃条、缩放钮、文字全部回到浅色一套。
`status-bar-style="dark-content"` 落在 map 容器上，状态栏文字在浅底图上仍是深色。

**换台 loading**：`derive busy = tuning or spinning` 覆盖「请求中 → 落点 → 滑动」整个过程；
`radio-next` 加 `disabled=busy`，`busy` 时图标换成会转的 `symbol:refresh`（`keyframes turn` 0→360°，900ms 线性），
副标题变成「正在换台…」/「正在移过去…」。`tune` 的守卫也从 `not tuning` 改成 `not busy`，
连点不会堆叠请求。

**百分比居中在 macOS 上不成立**：`left="50%" top="50%"` 配 `translate="-50% -50%"` 在 macOS 上量出来是
`(-490, -250)` 而不是 `(-150, -310)`，地图只盖住窗口一部分。改成 `margin-left=(0 - map.half)`、
`margin-top=(0 - map.half)`（`half` 由 `map` 资源返回 `MAP_BOX / 2`），三端都居中。

## 27. 搜索的筛选改成系统菜单 + 空态的坑

**字符串插值只在反引号里**：`title="没有找到「${applied}」"` 是普通字符串，原样显示了 `${applied}`。
改成 `title=\`没有找到「${applied}」\`` 才对 —— 双引号里没有插值。

**筛选为什么难看**：原来铺了两行胶囊（11 个语言 + 5 个编码），是 Web/Material 的 chip 网格，不是 UIKit 的形状。
Apple 的对应物分两种：

- **search scopes**（搜索栏下面那一条作用域）——适合「单一维度、互相排斥、选项少」；
- **pull-down menu / UIMenu** ——适合「若干互斥选项 + 当前值要看得见」。

我们有两个维度（语言、编码），所以采用后者：两个紧凑按钮「语言 …」「编码 …」，
`popovertarget` 指向 `column popover="auto" role="menu"`，每一行是
`role="menuitemradio" aria-checked=(…)` —— iOS 上直接变成 UIMenu（带勾选、带分组标题），
web 上是原生 popover 列表。选中后按钮变成实心强调色胶囊显示当前值，旁边出现「清除」。
这比 18 个胶囊省掉两行，也符合 HIG「小集合用菜单、当前值要可见」。

按钮上的指示符用 **⌄（`symbol:forward-chevron` 转 90°）**，不是「…」：省略号在 Apple 的语汇里表示
「打开一个需要继续输入/确认的模态」（例如「更多操作…」），而就地弹出菜单用下拉箭头。

**空态要给出口**：筛完没结果时，空态里多一个「去掉「中文」筛选」按钮，而不是只让用户自己想起清除。
（顺带把这里的 EmptyState 换成手写的图标 + 标题 + 说明 + 按钮，因为 `EmptyState` 自己会撑满剩余高度，
把按钮顶到屏幕底部。）

## 28. 一个浮动播放条，三个 tab 共用

- 播放条本来就是 `main` 层的一个绝对定位胶囊（在路由外面），之前只是用
  `display=(nav.tab == "radio" ? "none" : "flex")` 在世界页藏起来、另画一套大面板。现在删掉藏和那套面板：
  条件改成 `if (hasCurrent or nav.tab == "radio") and not inNow`，世界页也用它。
- 世界页没有在播时，播放条里换成「还没在播 / 点右边的箭头，随机开一台」+ 下一台按钮 —— 空着的地图也有入口。
- 播放条新增 `player-next`（44pt 圆形，⏭ 双箭头，`press=tune`，`busy` 时换旋转的 `symbol:refresh`），
  三个 tab 上都能随机换台；`player-toggle`、`player-open`（点条子开 sheet）保持原样。
- 世界页只剩三样浮层：右上缩放钮、左下「提示 / 归属」小胶囊（`bottom=166`，让开播放条），以及整屏地图。
- 世界页路由的 `padding-bottom` 仍是 0，所以地图铺到最底；播放条浮在上面，跟发现页的位置一致。

## 29. 地图交互：拖动是浏览，点一行才是命令

改之前的三个毛病（都实测过）：没有位移阈值（点一下地图也会换台）、等待 `geo_distance` 的那 1–2 秒完全没反馈、
结果直接飞走且"附近没台"时静默。现在改成：

**阈值**：`globeMove` 里位移超过 24pt 才把 `dragMoved` 置真；`globeUp` 只在 `dragMoved` 时才记录落点并查询，
轻点地图什么都不做（不再误换台）。

**落点与半径**：松手记 `pickLat/pickLon`，半径由缩放决定 —— `fn radiusFor(z) = z <= 3 ? 1500 : z == 4 ? 800 :
z == 5 ? 400 : z == 6 ? 200 : 100`（公里），`nearest` 里再 ×1000 换成米。这样"屏幕里看到多大就搜多大"。

**卡片**：`areaOpen` 时在播放条上方浮一张卡（`bottom=166`、`max-height=42%`、36rem 居中）：
标题「附近的电台」+ 副标题（`10 个 · 1.5 千公里内 · 按距离`），下面是

- 查询中：`animation="pulse"` 的三行骨架；
- 有结果：`list` 滚动，每行 = 封面 + 台名 + 简介 + 距离（`distanceKm` 由 `nearest` 从索引的 `geo_distance`
  换算，索引给的是**米**，除 1000 才是公里），正在播的那行显示「正在播放」；
- 没结果：「这一带 100 公里内没有登记的电台」+「扩大范围」（半径 ×3）+「回到当前电台」。

**点选**：`playArea(s)` 才播放，随后 `spinTo` 到台的位置并关掉卡片；地图上保留两枚 pin ——
松手处是空心圆环（`pick-pin`），电台是实心蓝点，中间用 `svg` 的 `line` + `stroke-dasharray="6 7"` 连一条虚线。

这样"你选的位置"和"最近的台在哪、多远"同时可见，也不用再猜为什么拖了没反应。

## 30. 一次误删与重写（教训）

改「无图标占位」时用 `s.index('text s.name …', row_start)` 定位一段行模板，`index` 命中的是**区域列表**里的同名行，
`s[:row_start] + row + s[row_end:]` 于是把中间约 170 行抹掉了；项目不是 git 仓库，`app.plan` 是二进制、
`app.plan.map.json` 只有行列号，没有源码 —— 只能整份重写。

重写时确认下来的语法点（都踩过一遍）：

| 想写的 | 正确写法 | 报错 |
| --- | --- | --- |
| 记录类型 | `shape X` + 缩进 `a: string`，**不要花括号** | `syntax-expected` |
| 函数 | `fn f(a: string): string =` 换行缩进函数体 | `expected :/=` |
| 布尔 | `bool`（不是 `boolean`） | `type-unknown` |
| 路由所在 | `column navigationKey=…` 必须是导航根的直接子节点，或在被 tab 按钮 `aria-controls` 链到的 `role="tabpanel"`（**带 `id`**）里 | `lower-route-place` |
| 导航回调 | `navigate=follow` 的 `follow` 要声明 `target: string`，再自己 `go(nav, target)` | `type-handler-payload` |
| 搜索框 | `input=type`（只改 draft，交给 450ms 的 `liveSearch`）+ `value=draft` | 直接 `commit` 会绕过防抖 |
| 弹出菜单 | `popovertarget="lang-menu"` + `column popover="auto" role="menu"`；按钮的 `press` 仍需一个存在的 action | `unknown name` |

另外：`if` 分支里不能塞路由节点；`match` 必须写 `case none`；无 favicon 时用灰底 + `symbol:radio` 占位而不是空 `image`。

## 31. 播放面板与地图交互的五处打磨

- **三个按钮居中**：row 上的 `gap` 会让内容靠左，加 `width="100%" justify-content="center"` 才真居中。
- **切换中的状态**：`derive busy = tuning or spinning`。中间键 busy 时底色换成 `-exact-secondary-background`、
  图标换成 `symbol:circle`（灰圈＝禁用），右侧「下一个」busy 时显示**空心圆环**表示加载；
  「旋转箭头」这种 loading 全部删掉（连 `keyframes turn` 一起删），因为它在三端观感不一致。
- 排查记录：一开始 busy 的下一个按钮画出来是**方块**，试过去掉 `disabled=`、把 `background-color` 放在 `view` 上、
  把动画从 icon 挪到容器、整颗按钮在 `if busy` 里换一份、svg 换成 image —— 都是方块。
  真因是**驱动 `tap` 留下的按下高亮**盖在圆上；换个不点它的路径（先在浮动条点 next、再进面板）拍出来就是圆。
- **拖动时的中心点**：`globe` 上叠一个 `testId="map-center"` 的空心圆（`left/top="50%"` + `margin-left/top=-14`
  + `border="3px solid rgba(20,60,140,0.55)"`），松手后它变成 `pick-pin`（实线圆环）并开始查询。
- **区域列表自适应高度**：卡片列去掉 `flex=1`，列表给 `max-height="46%"` —— 3 条结果时卡片就 3 行高，
  不会撑到大半屏留白。
- **自动扩大范围**：`task autoWiden when areaOpen and areaEmpty and areaRadius < 6000` → `after(500, widenArea)`，
  每 500ms 半径 ×3（100 → 300 → 900 → 2700 → 6000），到 6000km 或查到结果为止，不再等用户点按钮。

## 32. 两个遗留：macOS sheet 头部被标题栏吃掉、web 上的箭头

**macOS 的 sheet 头部**：`layout player-panel` 报 `space viewport 241.5,0 617.5×694`，而
`viewport … safe-area 52 0 0 0` —— 模态路由的内容从 y=0 开始，**上面 52pt 被窗口工具栏盖住**，
所以「收起 / 正在播放 / 关闭」那一行看不见（节点一直在，只是画在栏下面）。
修法：给面板列加 `padding-top="calc(12px + var(--exact-safe-area-inset-top))"` ——
macOS 上这个变量是 52，iOS 的 sheet 里它是 0（sheet 自己已经内缩过），所以两端都正好。

**web 上的箭头不画**：`symbol:forward-chevron` 在 web 上量出来是 0×0（Apple 端正常），
`rotate="90deg"` 也不对 —— `rotate` 是 f32 角度，要写 `rotate=90`。索性把三处箭头
（面板的「收起」、搜索页两个筛选按钮）都换成内联 SVG：
`svg width=14 height=14 viewBox="0 0 24 24"` + `path d="M6 9l6 6 6-6"`，
`stroke=(颜色)` 可以直接吃角色名（`"AccentColor"`）或三元表达式。三端一致。

## 33. 收窄底部两件套与播放面板的按键组

- 浮动 tab 栏：`max-width` 36rem → **22rem**、高度 60 → 56、圆角 30 → 28，仍然 `left/right=12` + `margin auto` 居中，
  于是宽窗下是一条居中的小胶囊，手机上两侧留白也够。
- 浮动播放条同步收到 **22rem**（`bottom` 94 → 90），两者同宽、上下叠放，视觉上成对。
- 播放面板的按键组：间距 28 → 20、三颗圆钮 64 → 56（圆角 32 → 28，图标 24/26 → 22/24），
  仍保持 `justify-content="center"`，整组更紧凑也更居中。

## 34. 装到 Android 真机

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # 系统 JDK 是 11，Exact 要 17+
cd airwave && bun exact.mjs android            # 构建 + 安装；--run 顺手拉起
adb -s <serial> shell am start -n com.lizhuo.airwave/dev.exact.app.MainActivity
```

- 产物：`target/android/app/outputs/apk/release/app-release.apk`（30MB，versionName 0.1.0 / versionCode 1，
  minSdk 31 / targetSdk 36），包名 `com.lizhuo.airwave`，启动 Activity 是 **`dev.exact.app.MainActivity`**
  （不是 `.MainActivity`，写错会 `Error type 3`）。首次构建 ~3 分钟，增量 8 秒。
- 真机（小米 24129PN74C / `3de8f372`）上验证：地图瓦片、玻璃胶囊 tab 栏与播放条、恢复上次电台且暂停、
  `discoverList.length == 40`、搜索与收藏页都正常。

两处平台差异（都是 Exact/Android 的既有行为，不是这个 app 的 bug）：

1. **外观跟随设备**：`app.json` 的 `userInterfaceStyle` 只作用于 iOS/macOS/web，schema 原文
   "Android, Linux and Windows follow the device"。所以系统深色时两条玻璃胶囊会变深灰，而地图仍是浅色底图。
2. **强调色来自 Material You**：`AccentColor` 落到 Android 是 `colorPrimary`，由壁纸取色（这台机器是棕褐色）。
   在根上写 `accent-color="#0C7CFF"` 也没能盖掉它 —— 想固定品牌蓝，得改 Android 宿主主题或关掉动态取色。

## 35. 声音消失的根因：重写时漏了 `audio` 元素

`app.contract` 整份重写时把**播放器本身**弄丢了 —— `view` 里没有任何 `audio`，于是 `play()` 只把 `status`
设成 `"loading"`，之后既没有 `playing` 也没有 `error`，四端全部「没声音」。补回：

```contract
      if hasCurrent
        match current
          case some(s)
            audio src=s.stream paused=(not wantPlay) volume=volume
              metadata=MediaMetadata(title=s.name, artist=s.tagline, album="Airwave", artwork=s.favicon)
              play=started playing=started pause=pausedNow ended=pausedNow
              loadedmetadata=loaded error=failed nexttrack=nextStation
          case none
            view width=0 height=0
```

两个签名坑：`error=failed`（**不要**写 `error=failed(code)`，`message` 由平台按
`action failed(message: string)` 注入）；`previoustrack` 没有对应 action，先不绑定。

**Android 仍然没有声音**，但原因不同：`host/android/canvas` 里只有 `sound` 运算（AAudio 短音效）、
`AudioFocus`、`Tracks` 的**采集**（`AudioSource`），没有 `MediaPlayer`/Media3/ExoPlayer 一类的播放器 ——
Exact 的 Android 端还没实现 `audio` 元素的长媒体播放。所以那边 `status` 会一直停在 `loading`。

## 36. 双指缩放（pointer 事件自己算）

Contract 没有 pinch 手势原语，只有 `touch-action` 和 `pointerdown/move/up`，但 `PointerEvent` 带 `pointerId`
（鼠标恒 1，每根手指各自唯一）。于是自己追踪两个触点：

- `state p1id/p2id/p1x/p1y/p2x/p2y/pinchSpan/pinched`；第一根手指按下记 p1 并开始拖动，第二根按下记 p2、
  记下两点距离平方 `pinchSpan`、`pinched = true`、停掉拖动。
- `globeMove` 里按 `pointerId` 更新对应点；两点都在时比较距离平方：`span > pinchSpan * 1.8` 就 `mapZoom + 1`，
  `span * 1.8 < pinchSpan` 就 `mapZoom - 1`，并把基线重置成当前距离（连续捏合就连续分级）。
- `globeUp(e)` 用 `let wasP1/wasP2/last` 先算出「最后抬起的是哪根」，**再**清 `p1id/p2id` ——
  因为 action 里的赋值要到动作结束才提交，直接 `if p1id == 0` 会读到旧值（这个坑踩过一次，导致松手不弹卡片）。
- 捏合结束时 `pinched` 为真，不触发「松手搜索」，避免缩放顺手把电台换了。

## 37. 封面加载失败时的占位

`if favicon != ""` 决定「画图还是画占位」不够：favicon 是个坏 URL（Android 上常见 `unknownIssuer`、
`DecodeFailed`）时，条件成立、图却画不出来，卡片就留一块空白。改成**占位永远在下面**：

```contract
view width=116 height=116 border-radius=14 position="relative" overflow="hidden"
  background-color="-exact-secondary-background"
  image "symbol:radio" width=34 height=34 position="absolute" left=41 top=41 color="-exact-secondary-label"
  if s.favicon != ""
    image s.favicon position="absolute" left=0 top=0 width=116 height=116
```

图加载成功就盖住占位，失败就露占位。

## 38. 去掉睡眠定时

按需求整块移除，涉及 `app.contract` 六处：`state sleepLeft/sleepChoices`、`derive sleepMinutes`、
`task sleepTick`（`every(1000, tickSleep)`）、`action sleepFor/sleepOff/tickSleep`、`stopPlayback` 里的
`sleepLeft = 0`，以及面板里那一行（月亮图标 + 15/30/60 分钟胶囊 / 「还有 N 分钟停止」+ 关闭）。
面板现在音量滑杆就是最后一行。测试里 `expect state sleepLeft == 0` 一并删掉，改名「the player starts at full volume」。

## 39. Web 发布：静态产物 + 一条 fallback

`bun exact.mjs web-build --out dist` 出的是纯静态站点（3.2MB，`index.html` 136KB + `app.js` 320KB +
`app.plan` 76KB + `shell.html`/`routes.json`/`manifest.json`/图标/按需加载的 `*-glue*.js`），
托管只需要一条规则：**有文件发文件，其余页面导航回 `shell.html`（200）**。

- Cloudflare Pages / Netlify：`_redirects` 里 `/*  /shell.html  200`
- Vercel：`vercel.json` 的 `rewrites`
- GitHub Pages：`cp shell.html 404.html`
- nginx：`try_files $uri /shell.html;`

三件容易踩的事：① `dist/.exact-build.json` 不能删（`serve` 靠它认构建）；
② `/tag/:tag`、`/country/:code` 是无界动态路由，预渲染不出来，只能靠 fallback；
③ 产物没有 service worker，Chrome 不会给安装条，iOS 靠 `apple-mobile-web-app-capable` 走独立窗口。

## 40. 正在播放面板：去掉关闭键、点外部收起

- close 按钮整颗删掉（收起箭头仍在左上，逻辑不变）。
- 模态 sheet 路由**不会**因为点背景而关闭（实测 web/iOS 都是），所以自己在路由根上加了一层「scrim」：
  ```contract
  column flex=1 position="relative" justify-content="flex-end" press=collapse testId="player-scrim"
    column box-sizing="border-box" width="100%" max-height="94%" gap=14 press=noop testId="player-panel"
      background-color="-exact-background" border-top-left-radius=28 border-top-right-radius=28
      box-shadow="0 -18px 44px rgba(8, 16, 30, 0.16)"
  ```
  `press=collapse` 在根上、`press=noop` 在卡片上（`action noop` 早已存在）：点卡片外的空白就收起，
  点卡片内部不误触。`.max-height="94%"` 留出可点的边距；**不要**给 scrim 加底色 —— iOS 上它会被画进 sheet 里面，
  变成一条灰带（试过 `rgba(15,23,42,0.28)`，很难看）。
- 三端验证：web 点顶部空白 → 路由回到 `/`（`state nav.tabs` 的 home 栈只剩一项）；iOS 卡片圆角与投影正常，
  仍可用系统 sheet 的下拉关闭。

## 41. 播不出来的电台：先过滤、再兜底、最后说人话

- **过滤**（`app.ts` 的 `normalize`）：除了原来的 `hls !== 0`，再加两条——`\.m3u8` 结尾的地址一律丢掉
  （索引经常把 `.m3u8` 的 `hls` 标成 0），`\.m3u`/`\.pls` 也丢掉（播放列表文件对 `<audio>` 不是音频）。
  实测 top300 只多掉 1 条，但能避免「点了转圈半天」。
- **兜底**：`Station` 新增 `fallback`（索引里的原始 `url`，与 `url_resolved` 不同且是 https、且不是播放列表）；
  `derive curStream = match current { … triedFallback and s.fallback != "" ? s.fallback : s.stream }`，
  `audio src=curStream`。`failed()` 里先看有没有可换的 fallback：有就 `triedFallback = true; status = "loading"`
  （换地址重试一次，不计入跳过），没有才走原来的「自动连跳 2 台」。`play`/`retry`/`nextStation` 都会重置这个标志。
- **说人话**：`derive errorHint` 把 `errorCode` 映射成
  「这台连不上，可能是地区限制或地址失效」/「这台用了当前浏览器不支持的编码（多为 HLS）」/
  「这个地址不是音频流」/「被浏览器拦住了，点一下播放键再试」/「这一台暂时播不出来」。
- 语法坑：`match` 和三元表达式**不能跨行随性折行** —— `derive x = match y { case … }` 要写在一行里，
  长三元要整体用括号包住，否则报 `expected ,` / `the ternary's : is on the next line`。

## 42. 深链 404 回退：删掉多余的 `404.html`

- 现象：`4a3227e` 这次部署之后，`/radio`、`/tag/jazz` 从 200 变成 **404**，而 `/` 正常；同一份 `web/_redirects`（`/*  /index.html  200`）在它之前的两个部署里是好的。
- 差异只有一个：`scripts/publish-web.sh` 里那句 `cp dist/shell.html dist/404.html`（本意是给 GitHub Pages 这种没有 rewrite 的托管用）。
  **Cloudflare Pages 看到部署根目录里有 `404.html`，就用它回答所有未命中路径，`_redirects` 的 200 规则被绕过了。**
- 修法：`404.html` 只在 `plain` / `github` 目标时生成：
  ```bash
  case "${1:-}" in
    plain|github) cp dist/shell.html dist/404.html ;;
  esac
  ```
- 验证：重新发布后 `/`、`/radio`、`/tag/jazz`、`/nope` 全部 200 且返回同一 shell。
- 教训：Pages 上「SPA 回落」只留一套机制（`_redirects`）；别同时放 `404.html`，两者会打架。

## 43. 优化轮：五个老 bug + 静音记忆 + 骨架屏 + 缓存 LRU

**修的 bug（都是通读代码找出来的）：**

1. **地图经纬度错位**（`app.contract` 的 `globeUp`）：`pickLat = globeLon`——从第一个提交起就把经度当
   纬度用，「这一带有什么电台」一直搜错位置。实测验证：拖到圣赫勒拿岛落点 (-10.5, -13.1)，搜到的正是
   `Radio Jamestown`；拖到卡累利阿 (61.4, 33.1)，最近的是莫斯科台 681km——修复前不可能命中。
2. **`app.ts` 的 `nearest()` 距离张冠李戴**：`sorted[index]` 和 `toStations` 过滤后的数组索引错位
   （normalize 丢行后，A 台的公里数贴到 B 台上）。改为每行带自己的 `geo_distance` 走完全程。
3. **「换一台」从不换台**（`nextStation`）：有 current 时 `play(s)` 原地重播同一台，死链时无限重播。
   重写为 `advance()`：按当前页面的列表（tag/country/search/favorites/discover）取「不是当前台的下一台」，
   世界 tab 或列表空则随机 `tune()`；并拆出 `start(s)`（不重置跳过预算）与 `play(s)`（重置）。
4. **自动连跳预算重做**：原来 `skips` 每次 `play` 都清零，永不耗尽。现在是 `autoLeft`（play/换一台时 =2）：
   `failed()` 只在 `autoLeft > 0` 时武装跳过（`skips=1`），`autoSkip` 消耗一次（`autoLeft-1`）再 `advance()`；
   两跳后停下，`failedPlayer` 显示错误行（重试/换一台）。offline 时不再无限刷。
5. **`widenArea` 越界**：`4500 * 3 = 13500` 超过 6000 上限，改 `min(areaRadius * 3, 6000)`；
   `areaKm` 文案「1.5 千公里」→「1500 公里」。

**新功能（睡眠定时当晚又被要求移除，见 §44）：**

- **静音记忆**：`toggleMute` 静音时把音量存进 `lastVol`，再点恢复（默认 0.8 兜底）。
- **发现页骨架屏**：`discoverLoading`（pending 且空）时 4 行 pulse 占位，不再白屏等首屏。
- **feed 缓存 LRU**：去掉 `want <= PAGE` 就丢缓存重抓的行为（切 tab 回来必重 fetch）；改为会话内
  命中缓存、上限 12 条按插入序淘汰。数据源里不许 `Date.now()`（确定性环境，编译报
  `analyze-ambient-api`），所以没有 TTL——radio-browser 数据变化极慢，会话内缓存够用。

**这次的语法/测试教训：**

- **action 内的读是「动作开始时」的值**：`b = a` 读到的是旧 `a`（编译器有 `analyze-read-after-assign`
  警告）。写法：`let next = (三元); a = next; b = next`。
- 测试里 tap 之后要 `clock +1`（或 `clock settle`）状态才落地；`every(N)` 的任务在测试假时钟下
  `clock +N×k` 会逐次触发。
- 测试从 11 个加到 12 个（静音记忆），12/12 绿。

## 44. 第二次移除睡眠定时（别再加了）

用户在 §43 当晚要求整块移除。这是本项目**第二次**「加了又删」睡眠定时（第一次见 §38）：
涉及 `state sleepMin/sleepLeft`、`action cycleSleep/sleepDown`、`task sleepTick`、
面板里的 moon 芯片（`panel-sleep`）、测试「the sleep timer cycles, counts down and pauses」、
README 两处文案。`docs/images/ios-player.png` 截图里如果拍到过 moon 芯片，重截即可（UI 里已无此按钮）。
**结论：睡眠定时不再加回来，除非用户主动要。**

## 45. 地球仪（世界 tab 重做：Esri 瓦片 → canvas 自绘地球）

完整方案与取舍见 [09-globe-plan.md](09-globe-plan.md)；这节记实施时的坑。

- **canvas 不能 `position=absolute inset=0`**：高度塌成 ~160px 白屏。必须包一层 absolute view，
  canvas 在里面 `width=100% height=100%`（weatherlight 先例）。
- **测试里的 task 定时器要显式 `clock +N`**：`clock settle` 只等回复与转场，不等 `after 600/350`
  的 task；`autoPick`/`refreshOnce` 的测试都要补 `clock +1200`。
- **种子不能装进模板字符串**：`export const SEED = \`<json>\`` 会被 JS 求值——
  ① Radio Brașov 的 url 自带 `?nocache=${Math.random()}`，bake 直接报
  `Math.random() is unavailable in data sources`；② 就算滤掉它，json.dumps 的 `\"`/`\n`
  转义在模板字面量里被求值，数据静默损坏（`JSON.parse` 报 `Expected ']'`，
  种子 0 行、origin 变 "net"）。**正确做法：生成 JS 数组字面量** `export const GLOBE_SEED = [[…],…]`
  （数据即代码，没有解析环节），运行时 `seedRows()` 只做形状校验；`${`/反引号在
  snapshot 与 `seedRowOf` 两处都拒绝。
- **原生 payload 里的种子位置**：mac/iOS standalone 跑 `…/link/plan/app.hbc`（2.05MB，含种子）；
  `…/updating/development/plan/app.js` 是 dev-server arm（无种子，agent 驱动用的就是它，
  所以 agent 里 origin 是 "net" 属预期）。Android 的 plan 烤在 `lib/arm64-v8a/libexactcanvas.so`
  里（README:266 "the reader boots the plan its APK bakes"）。web dist 的 app.js 保持 ~387KB 无种子。
- **构建脚本**：`scripts/build-native.sh mac|ios|android` 先把 `.research/geo/globe-seed.full.ts`
  拷进 `data/globe-seed.ts`（git 默认 `[]`）、构建完 trap 还原；`scripts/snapshot-globe.sh`
  从 radio-browser 三页 4000 重建快照（当前 7,991 台 / 1.71MB）。
- **iOS 真机渲染验证**：vello/metal 下像素分析 dark 80.4% / land 11.9% / UI 6.9% —— 地球画出来了。

## 46. 地球仪拖动卡顿：一帧的开销砍到 1/31 次绘制调用

症状：放大后拖动地球掉帧。profile 下来三个源头——

1. **每点每帧 6 次三角函数 + 一个新对象**：`project()` 对 7,991 个站点、
   4,994 个陆地顶点、~500 个网格点每帧各返回一个 `{x, y, visible}` 字面量
   （~8.5k 次/帧的分配，GC 停顿才是卡顿主源；`Math.sin(phi0)` 还对每个点重算）。
   → `buildDataset` 预计算单位 3D 向量（`px/py/pz`），每帧先算一次视角基
   （V/E/N 三个向量），每个点变成 3 个点积、零分配。
2. **279 次 fill/stroke**：128 个陆地环每环各自 beginPath/fill/stroke、16 条网格线
   各自 stroke。→ 陆地全部环并成一个路径（一次 fill + 一次 stroke），网格并成一次
   stroke：**279 → 9 次绘制调用**（vello/canvas 每次 fill 是一个 render pass，
   端上这才是大头）。
3. **小点档位的重叠绘制**：密集区（欧洲）上千个 1.6px 点叠在同一片像素上。
   → dot < 2px 时按 ~2.5px 屏幕格子去重（数据按 votes 降序，热门台先占格子），
   视觉不变、overdraw 大降；放大后点距拉开，去重自然失效、全部照画。

bench（桌面 bun、stub ctx、7,991 点全量）：0.440 → 0.283 ms/帧 JS 侧；
验证：web 拖动+自动播放全链路照旧，iOS 像素统计与优化前逐项一致（80.4/11.9/6.9）。

两个坑：
- **Ctx2D 的渐变对象活不过当帧**：缓存 `createRadialGradient` 的结果跨帧复用，
  GPU host 上整块画布变黑（web 上 DOM ctx 常驻所以没暴露）。每帧重建即可，代价可忽略。
- **agent macos 驱动截图全黑是工具限制**：驱动模式没有真实 GPU 表面
  （日志 `GPU module … missing baked identity`），canvas 全黑；真实启动
  `open Airwave.app` + `screencapture -R` 窗口区域验证渲染正常（dark 80.5%）。
  iOS 驱动模式有 GPU 表面，可照常截图。

## 47. 地球仪换成平台地图：@exact/maps（MapKit / OSM）

用户指出 canvas 自绘地球在放大后拖动仍然卡（第一轮优化后依旧），且 SDK 自带
`@exact/maps` 包（apps/map-demo 是官方 demo）：**Apple 端 MapKit、web 端
OpenStreetMap 瓦片、Android 端 Google Maps**。渲染负载全部交还平台，卡顿
根因（5.5k 可见点逐帧重画）自然消失。

**接入**：`bun exact.mjs add maps` → package.json 依赖 + app.json 配
`packages: {"@exact/maps": {web: {tiles: OSM 模板, attribution, maxZoom:19}, android:{}}}`。
合同头部 `use MapCamera, MapMarker from "@exact/maps"`；视图 `exact-map
latitude/longitude/zoomLevel/markers/selected`，事件 `change`（点图钉，参数
marker id）与 `moveend`（相机落定，参数 MapCamera）。macOS 需
`host.macos.minimumOS = "14.0"`（iOS 已是 17）。

**合同侧**：删掉整套手势/spin（globeDown/Move/Up/Wheel、zoomIn/Out、
spinTo/spinFrame/spinTick、18 个 state）；新增 `mapMoved(c)`（落定→弹附近卡
+bump settleRev）、`mapPicked(id)`+`playPick`（点图钉直接播）、`flyTo(lat,lon)`
（单次相机变更，动画交给 MapKit）。**quietMoves 计数器**区分程序化移动：
flyTo/restoreLast 先 +1，mapMoved 消费，quiet 时不弹卡不 bump——否则 MapKit
连自己动画结束的 regionDidChange 也会当成用户手势。缩放/捏合/归因/指南针
全部交给平台（web 自带 +/− 按钮，macOS 自带缩放控件）。

**数据侧**（app.ts）：新 source `mapPins(lat,lon,zoom,count)` —— 半径
66000/2^zoom km 内按 votes 降序取 ≤250/400/600（按 zoom 分档）个 MapMarker，
不足 40 个补最近 40；zoom≥5 才带 title（低 zoom 不出文字标签）。
`stationById(id,camLat,camLon)` 把点选的图钉水化成可播 Station。
**资源链坑**：`resource pins = mapPins(pickLat, pickLon, pickZoom, globeData.count)`
——参数里必须挂 globeData.count，否则数据集加载完成后 pins 不会重查（模块
内状态变化不触发资源重查，m09116 踩过）。globe.ts 削成纯数据层
（buildDataset/parseSeed/haversine/nearestIn，115 行），paintGlobe/land.ts
（56KB Natural Earth 轮廓）删除。

**验证**：13/13 测试绿；web（OSM 真瓦片 `prefer extension maps.tiles="live"`）
拖动→落定→自动播放、ask-play→flyTo 静默、图钉点选全链路通（图钉点击要选
屏幕内且不与其它图钉重叠的——agent 命中测试比真实浏览器严格）；iOS 模拟器
红图钉可见、拖动后 autoplay；macOS 真窗口 screencapture 验证（agent macos
截图全黑仍是工具限制）。三端 APK/app 均带 7,991 台种子构建。

## 48. 去掉「停下自动播最近」：图钉点播是唯一入口

用户：有了图钉点击，去掉地图停止滚动后默认搜索中央位置最近电台的整套逻辑，
让用户自己点图钉播放。

**删除**（app.contract −170 行）：areaMode/quietMoves/settleRev/autoTune 四个
state、areaOpen/areaAsking/areaBusy/areaEmpty/askName/askFavicon/askKm 七个
derive、nearby 资源、autoPick task、closeArea/toggleAutoTune/playNearestNow/
openAreaList/askPlayNearest/playArea/recenterOnCurrent 七个 action、「附近的
电台」卡片整套 UI（ask/list 两态 + 骨架屏 + 空态）、右上「自动播放」开关。
app.ts 删 globeNearest source（nearestIn 仍被 mapPins 用）。onKey 的 Escape
分支只剩收起面板。

**简化后的语义**：mapMoved 纯同步相机→picks（图钉跟着镜头走，程序化移动也
一样——quietMoves 不再需要）；flyTo 只改相机。播放入口 = 点图钉
（mapPicked→pickStation→pickPlay）或右下「随机开一台」（tune）。
aria-label/hint 文案改「点图钉播放电台」。

**验证**：13/13 测试（settled-map 测试改为断言拖动后 1.5s 仍 idle、hint 文案）；
agent web：拖动后 status "idle"、currentId ""、无卡片节点，点独居图钉
f8c657d3 → 播放 "P5 Nonstop Hits"；三端重建 + Android 真机装新 APK。

## 49. 绿点图钉（默认圆点不显名，选中显名 + 加深 + 1.5 倍 + 脉冲）

用户指令（m09465）：①图钉默认=浅绿圆点、不显示名称；②选中=显示名称+颜色加深+1.5 倍+脉冲动画（live）；③清旧代码。

**四端实现**（前两轮的旧尝试已废弃）：

- **web**（`@exact/maps` web/index.js）：`.marker` 用 `translate(-50%,-50%)` 居中锚定；label 默认
  `display:none`、`[aria-pressed="true"]` 时显示（白底圆角 chip、11px semibold）；选中态外圈
  22px 绿环 `animation: exact-map-pulse 1.5s ease-out infinite`（scale .6→1.9 + opacity .9→0）；
  `pin()` 画 20×20 SVG 圆（r=7.2、白描边 2.6）；`restyle()` 选中 24/16px、`#059669`/`#34d399`。
- **Apple**（maps/apple/Maps.swift）：**macOS MapKit 不给自绘/子层注解定位**（draw() 探针只渲染出
  卡在 init frame 位置的一个色块，249 个注解全部没被搬到坐标；frame/bounds 变体、强制布局都无效），
  而 `image` 属性的注解立刻被正确定位 → 全平台改为 **CoreGraphics 烘焙图片**：`render(selected:title:)`
  画普通 14pt 浅绿圆 / 选中 21pt 深绿圆 + glow + 右侧白底圆角 chip（CoreText 画台名，chip 在右侧让
  dot 圆心保持画布垂直中心，`centerOffset` 只补水平偏移）；`setSelected`/`annotation didSet` →
  `restyle()`。iOS 额外 `configureRing`（CAShapeLayer + CAAnimationGroup 1.5s 无限脉冲）；mac 快照
  路径动画不可见，用静态 glow 兜底。
- **Android**（maps/android/Maps.kt）：`dot(selected)` 画 16/24dp×density 位图（白 rim +
  `#34D399`/`#059669`），markers 重建与 selected 变化时 `setIcon`，选中 `showInfoWindow`（Google
  Maps marker 不支持自定义连续动画，无脉冲，记档）。
- **app 侧**：`app.ts` `mapPins` 删 zoom≥5 才带 title 的门槛（名称全程随图钉，地图层默认隐藏）；
  `app.contract` exact-map `selected=selId` → `selected=currentId`（脉冲跟正在播的台）。死代码扫描
  （contract 声明 vs 引用、app.ts 函数）无残留。

**验证**：web 13/13；agent web 像素级（250 pins 全 16px、#34d399 中心命中、选中 #059669 148px +
脉冲环 + 白 chip + status playing）；mac 真窗口 screencapture（134 浅绿采样、10 个点簇散布中欧）；
iOS agent（7,013 浅绿采样）；Android 构建过、真机未连未装。

**⚠️ SDK 补丁清单**（`bun exact.mjs update` 会覆盖，需复查重打）：除 §0 的三个沙箱/缓存补丁外，
本节又改了 SDK 的 `packages/maps/`（web/index.js、apple/Maps.swift、android/Maps.kt）——都在
`.extern/exact`（gitignore），node_modules 是同 inode 硬链接，直接改 .extern 即可双路径生效。

**Swift 教训**：`#if` 不能内联 typealias（要 `#if` 块包两行）；`annotation?.title ?? nil ?? ""`
报 optional unwrap 错，要 `(annotation?.title ?? nil) ?? ""`；macOS `NSView` 不能 `view.addSublayer`、
要 `layer?.addSublayer` + `wantsLayer=true`；CTFontCreateUIFontForLanguage 返回可选要给 `??` 兜底。

## 50. 简洁性重构：组件抽取与死代码清理

用户指令（m09872）：「继续尝试代码优化让代码更加简洁」。只做结构简化，零行为变化。

- **app.contract（845 → 829 行）**：抽出三个参数化组件（`component X` + `props` 块，action 可以作
  prop 传递，`press=onTap` 是 handler-only 用法）：
  - `StationRow(s, onTap, active)` —— 电台行在类型/国家/搜索/收藏四个列表里重复三次（收藏版还
    缺「正在播」波形标记，统一后补上）；调用形如 `StationRow(s=s, onTap=play(s), active=(s.id == currentId))`。
  - `LiveBadge()`（无 props，LIVE 红标 ×2）、`NextIcon(size)`（双箭头 SVG ×3）。
  - 组件只能读 props/injects 和「声明在它上面」的名字——`currentId` 这类父级 derive 不直接可见，
  所以按值传 `active: bool`。
  - 删死代码：`action pick`（与 selectTab 全同、无引用）、`action goBack`（无引用）、`action loaded`
  （空动作 + `loadedmetadata=loaded` 一起删）；`derive pickRadius` 内联为 `nearKm(pickZoom)`；
  `onKey` 两层 if 合并为一个条件。
- **app.ts（659 → 656 行）**：`readStations`/`readStrings`/`writeStrings`/`writeStations` 四个函数
  收敛为 `readJson(storage, path, keep)`（keep 回调做校验+修复）+ `writeJson(storage, path, value)`；
  三个播放列表正则收敛为共享 `const PLAYLIST`。
- **globe.ts（103 → 102 行）**：删掉指向已删函数的尾部注释。
- 教训：sed/python 批量替换调用点时锚点要含分号/换行（第一次 `writeStrings(storage, SEARCHES, next)`
  没匹配上是因为实际代码带 `;`）；edit 工具删连续 action 块时容易顺手多删——`follow`/`noop`/
  `selectTab` 都在被误删后立刻补回，`grep -n` 验证引用再动手。
- 验证：contract build 零错误；`test web` 13/13；agent web 实测 StationRow 渲染 + 点击播放
  （station-595687e1 → status playing → player-open → panel-name "Christmas FM Non-stop!"）+
  tag 页 feed 正常；三端重建全过。

## 51. SDK 升级到上游最新（b2a7e278，2026-11-17）：Android 获得音频能力

用户指令（m10062）：「更新到最新 sdk 上游」。动机：上游 2026-11-16 的 `a0916e07` 给 Android host
加了 `host/android/video/` 模块（Media3 ExoPlayer，实现 `video` 与 `audio` 元素，LLP 1042.001），
APK 在 plan 含 `video`/`audio` 时自动链接——Airwave 的 `audio` 元素自动受益，顺带 media3-exoplayer-hls
让 Android 也能播 HLS。

- **升级方式**：上游重写历史（QUEUE 工作流），`git pull --ff-only` 报 diverging；正确做法是
  `git reset --hard origin/main`（SDK checkout 是依赖不是工作仓库，安全）。本地 7 个补丁文件先
  备份到 /tmp/sdk-patches 再恢复。
- **补丁重放**：`packages/maps/web/index.js`、`packages/maps/apple/Maps.swift`、
  `host/apple/svg-filter.mjs` 上游未动，直接拷回；`packages/maps/android/Maps.kt` 上游大改
  （lifecycle 改走 `viewLifecycle`、相机保存恢复、触摸拦截），把绿点 dot() 四个 hunk
  （imports/dot()/.icon()/setIcon 循环）重新套到新版上；`canvas/vello/build.rs` 的
  -fmodules-cache-path 与 `scripts/app.mjs`/`host/apple/build.mjs` 的 --disable-sandbox 按新行号重放。
- **工具链**：Rust pin 1.97.0 → **1.99.1**（rustup toolchain install + ios/android/wasm targets；
  .tools/env.sh 的 RUSTUP_TOOLCHAIN 已改）；`cargo fetch --locked` 补新 crate（core-foundation 0.10.1 等）。
- **Gradle locks**：`:video` 模块进图后构建失败，按提示 `bun exact.mjs android --write-locks` 重写
  gradle.lockfile/gradle-verification.xml 后通过。
- **验证**：contract build 零错误；test web 13/13（一次 12/13 是 radio-browser 超时，重跑过）；
  agent web 播放链路正常（station → status playing）；mac/ios 构建零 error；Android APK 42.26MB，
  classes.dex 含 1,944 处 media3/exoplayer 引用——**Media3 已链接**。
- **Android 真机仍未连接**，装 APK 验证声音是唯一遗留；media3 也带 hls，旧「.m3u8 过滤」策略在
  Android 上已可重新评估（暂未改）。

## 52. Android 真机验声（进行中，未定位）

- SDK b2a7e278 的 Android `audio` 支持确实存在（`host/android/video/` Media3，LLP 1042.001）；
  APK 的 classes.dex 里有 `Ldev/exact/video/MediaPlayer;`（video 变体已链接，非 novideo）。
  链路核对：`MainActivity.video = videoPlayers` → `Natives.videoView()` → `MediaPlayer`；
  `Sources.video()` 对 http/https 一律 `Source.Remote`（不是 grants 问题）。
- agent android 驱动的是**无头 reader**（设备上无 Activity、无 Media3），测不了声音；
  每次调用还 force-stop 真机 app。真机只能 adb input tap + dumpsys。
- 真机证据（MIUI，dark mode）：点按到达窗口（MIUIInput ACTION_DOWN/UP）、电台行命中
  （agent `tree --ax` 算出坐标 600,1245 = Christmas FM 行）、但 dumpsys audio 无我们的 player、
  logcat 无 ExoPlayer Init。注意：最后一次抓日志 grep 经过了 head -10，可能截断了滞后到达的
  ExoPlayer 行——不能下「播放器从未构造」的结论。
- agent android 驱动前置：staleness 检查比对 seed 内容。流程：
  `cp .research/geo/globe-seed.full.ts airwave/data/globe-seed.ts` → `bun exact.mjs android` →
  `touch -t 202611170000 airwave/data/globe-seed.ts`（mtime 早于 APK）→ 才能驱动。
- **另发现**：Android release 版地图是「No Google Maps key」占位 TextView（boot 日志
  `exact: map 180: no Maps SDK key`）。需要 `EXACT_GOOGLE_MAPS_API_KEY`（app.json
  packages["@exact/maps"].android.apiKey 指向的 env）才能出真地图。与声音无关。
- 下次连机：①点电台→开播放面板看 player-error 红字（failed=src-not-supported→流解析、
  not-allowed→音频焦点被 MIUI 拒）；②完整未过滤 `logcat --pid`；③试 BBC 等已知可播台。

## 53. Android 无声根因与修复（SDK painted host 补丁 ×2）

- **现象**：四端里 Android 点电台后 app 显示播放中（暂停按钮+LIVE 徽章）但完全无声；
  `dumpsys audio` 无我们的 player；logcat 零 ExoPlayer 日志。
- **根因链**（SDK b2a7e278）：
  1. `contract/lower/src/media.rs`：HTML 语义——`audio` 没绑 `controls` 时 lowering 强制
     `display="none"`（UA 规则 `audio:not([controls])`，作者写的 display 也会被剥掉），
     所以任何无控件的 audio 元素都没有布局盒。
  2. `host/painted/src/paint.rs:905`：display:none 的节点在 paint 遍历时直接 return，
     永远到不了 NodeType::Video → native() 分发。
  3. `host/painted/src/paint/native.rs:197`：即使到了分发处，`rect.w/h <= 0` 也会 return。
  - web host（DOM `<audio>`，display:none 照样出声）与 Apple host（不走 painted 的这两道门）
    都不受影响——只有 Android/painted 把无声 audio 丢了。SDK 自己的 media 集成测试是
    headless runner，测不到这条 painted 路径。
- **修复（.extern/exact 两个补丁，`bun exact.mjs update` / reset --hard 后必须重放）**：
  1. `host/painted/src/paint.rs`（skip 处）：`boxless_audio`（Video 节点 + SemanticTag=="audio"）
     豁免 display:none 的 return。
  2. `host/painted/src/paint/native.rs`（rect 门）：SemanticTag=="audio" 的节点豁免零尺寸 return。
- **验证**（真机 3de8f372，MIUI）：`ExoPlayerImpl: Init [AndroidXMedia3/1.11.1]`、
  `AudioTrack set(): packageName com.lizhuo.airwave`、`audioTrackData 35s f:35049 m:0`（35 秒
  连续渲染零卡顿）、`dumpsys audio` 出现 `piid:7127 type:AudioTrack u/pid:10889/32155`；
  暂停/恢复（重新 tap）后新 AudioTrack 会话继续出帧。流在漫游 LTE 上约 176kbps 可拉。
- 教训：无控件 `audio` 在 painted host 上 = display:none = 无盒 = 无播放器；排查顺序应是
  「logcat 有没有 ExoPlayer Init」而不是先怀疑网络/焦点。

## 54. OTA 热更新（deploy/push 签名流 + Pages 频道 + genesis 二进制）

**机制**（docs/recipes/over-the-air-updates.md）：`bun exact.mjs deploy` 分类并发布签名流到
origin（本地目录即 CDN 源）；`push` 秒级发布工作树到已装 release 应用。客户端
（store L=A 的二进制）fetch `<channel>/.exact/<channel>/<compat id>/exact.json`（head
envelope ≤64KB，签名覆盖 app/channel/compat/seq）→ 按摘要取 `.exact/blobs/<sha>` →
staged → **下次冷启激活**（默认 activate=next-launch）；前台每 ≥1 分钟、后台每 900s 检查。

**配置**：`bun .extern/exact/scripts/deploy.mjs keygen airwave`（私钥 `.tools/keys/airwave.pem`，
EXACT_SIGNING_KEY_DIR 指到那里）；app.json `deploy.store` 四端（web "0" 其余 "A"）+ 
`channels.prod = https://airwave-76y.pages.dev/updates` + `signing.keys`（公半入库）。
`scripts/build-native.sh` 带 `EXACT_UPDATE_GENESIS=1 ... --release` 出 genesis 二进制（嵌 seq 0）。

**四条血泪**：
1. **compat id 的输入含 `typescriptModule`**（app.ts 模块哈希，种子填充与否直接改变它）。
   deploy 的 capture 必须与 genesis 构建同种子状态，否则流 id 分叉、已装二进制永远 404 自己的流。
   `scripts/publish-ota.sh` 固化了「填种子 → deploy → 还原」顺序；Android 例外：deploy 从 APK
   的 production receipt 起流，id 天然对上。
2. **Cloudflare Pages 单文件 25MiB 上限**：origin 里 30MB+ 的 `releases/*.json`（source-capture
   记录，客户端不取）会让整个部署静默失败（旧部署继续服务，一切路径都变 SPA 回落 HTML）。
   publish-web.sh 同步时 `-size +20M -delete` 剥掉它们。
3. **SwiftPM 会把 XDG 目录搬到 ~/Library 并留逃逸符号链接**，deploy 的 capture 见到
   「symlink escapes the captured source repositories」就拒绝。根治 = 反转方向：真实内容放
   `.tools/home/.config/swiftpm/`，`~/Library/org.swift.swiftpm` 与 `~/Library/Caches/org.swift.swiftpm`
   改为指回仓库的符号链接（原内容 .orig 备份）。
4. **嵌套 dotfile/dotdir Pages 正常部署**（`.exact-build.json`、`.exact/**` 都能以
   application/json 服务）；诊断时别只看 200——看 content-type 是不是 text/html（= SPA 回落）。

**验证**（2026-11-18）：origin 三流 ios `397b7ee5` / macos `67b5c970` / android `5b016009`
全部 head seq 1（android 从 APK receipt 起流）。mac 裸执行 `./Airwave`：
`exact update: staged seq 1; downloaded 3 files in 2009.0 ms` → 重启 `exact update: current`；
plan blob（87,079B）内含标记文案「点图钉播放电台（已热更新）」。iOS sim 同样 `current`。
线上 https://airwave-76y.pages.dev/updates/.exact/prod/<id>/exact.json = application/json。
**日常发版：改代码 → `bash scripts/publish-ota.sh` → `bash scripts/publish-web.sh` → commit push。**
