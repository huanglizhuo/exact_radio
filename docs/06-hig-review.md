# Airwave 的 Liquid Glass / HIG 复核（2026-11-15）

依据：[apple-design-skill](https://github.com/dickwu/apple-design-skill) 的 `SKILL.md`（五镜复核流程）
与 `references/hig/liquid-glass.md`，以及 Apple 的
[Liquid Glass 指南](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)。
框架侧的事实来自 `.extern/exact/docs/contract-for-agents.md:5645-5660`、
`contract-for-humans.md:1033-1061` 与 `bun exact.mjs contract vocab --all`。

## 结论

上一版的底部导航是**内容层**：`appearance="none"` 自绘、`background-color` 不透明、内容到栏边就被裁掉。
这正是「看起来不像 Liquid Glass」的原因 —— 玻璃不是一种贴图，而是**功能层对内容层的实时采样**。
这一版把它改成真正的浮动玻璃：真机上是 `UIGlassEffect`（iOS 26）/ `NSGlassEffectView`（macOS 26），
网页与 Linux 上是 `backdrop-filter`，并且内容从栏下滚过。

## Critical（已修）

### 1. 导航栏在内容层，且不透明

- **What**：`row role="tablist"` 带 `appearance="none"` + `background-color="-exact-background"` + `border-top`，
  内容列在它上方截止。
- **Why**：glass 只属于功能层，且「用 scroll edge effect 而不是实色/半透明底色把控件与内容分开，
  并让全屏背景内容延伸到 sidebar、toolbar、tab bar 之下」
  （`liquid-glass.md › Where the material belongs`，引 Materials 与 Layout）。
- **Fix**：
  ```contract
  row role="tablist" testId="tabs" appearance="none" align-items="stretch"
    position="absolute" left=12 right=12 bottom=24 height=60 max-width="36rem"
    margin-left="auto" margin-right="auto"
    border-radius=30 backgroundMaterial="glass"
    backdrop-filter="blur(24px) saturate(1.4)"
    box-shadow="0 10px 30px rgba(8, 16, 30, 0.18)"
  ```
  同时列表与首页 `scroll` 加 `-exact-scroll-edge-effect="soft"`；路由底部 padding 从 66 改为 86 /
  有播放条时 150，让最后一行仍能滚到栏上方。

### 2. 迷你播放条是「第二条实色栏」

- **What**：播放条原来是不透明 `-exact-secondary-background` 的满宽行。
- **Why**：两条实色栏把屏幕切成三块；而玻璃的两个变体里，**文本多的表面用 regular**
  （`liquid-glass.md › Which variant`：regular「anything with a lot of text」）。
- **Fix**：浮动胶囊 + `backgroundMaterial="regular"`（不是 `glass`），
  `bottom=94` 叠在 tab 栏之上，两者左侧 12pt 内缩、圆角 30/20、各带一层投影。
  网页上 regular 会更不透明，iOS 上是系统材质 —— 这正是「同一条规则、各端最接近的材质」。

### 3. 迷你条的播放键只有 32×32

- **What**：`layout player-toggle` → `32×32`。
- **Why**：Apple 的最小触控目标是移动 44×44、桌面 28×28（`liquid-glass.md › Apple's rules` 末条，
  以及 accessibility 的触控目标要求）。
- **Fix**：按钮固定 `width=44 height=44` + 图标居中，条高抬到 `min-height=56`；
  复测 `layout player-toggle` → `44×44`。

## Improvements（本轮已实现）

1. **播放面板已是真正的 sheet 路由**。`routes` 里每个 tab 挂一条 `nowHome "/now"`、`nowSearch "/search/now"`、
   `nowFavorites "/favorites/now"`，共用一份模态标记：
   `navigationPresentation=(isNow ? "modal" : "")`、`navigationDetent=(isNow ? "large" : "")`；
   `expand` 用 `go(nav, …)` 推到当前 tab 的那条，收起/停止/到点自动关播都走 `back(nav)`。
   iOS 上是 UIKit 的 sheet（`presented="sheet"`、安全区 62/34、可下拉关闭），Web 上是 `/now` 的模态卡，
   macOS 上是窗口的 sheet 面板。`state expanded` 与 `aria-modal` 浮层已删除。
2. **辅助功能复核完成**（`xcrun simctl ui`）：
   - 深色模式：黑底、白字、玻璃转深色材质，正常（`a1.png`）；
   - Increase Contrast：边框与玻璃加深，正文对比度提高（`a2.png`）；
   - Dynamic Type `accessibility-extra-large`：**发现真实缺陷** —— tab 栏固定 60pt 时标签溢出，
     已改成 `min-height=60` + 内边距，让栏随字号长高（`a3.png` 修复前、`a4.png` 修复后）。
   - Reduce Transparency 无法用 simctl 设置，只能真机点按复核，仍未做。
3. **键盘**：`main` 上 `keycapture=onKey key=onKey`，`Escape` 关闭播放 sheet，`Space`（sheet 内）播放/暂停。
   macOS 菜单项仍缺：Contract 只允许通过**可见按钮**声明菜单项/快捷键（`-exact-menu="none"` 只留 chord），
   加三个影子按钮会把它们漏到 web 与 iOS 的界面里，所以先不做，等 Exact 给出不可见命令入口。
4. 玻璃只用在功能层：hero 卡、胶囊分组、列表行保持内容层。

## 另外补的（原计划 P2 遗留）

- **失败自动跳过**：`failed(code)` 时先静默换台（最多 2 次，`skips` 计数，`task skipOn` 900ms 后 `autoSkip`），
  全部失败才显示错误卡；`started` 里把计数清零。`nextStation` 也从「只看最近收听」扩展到「最近收听 → 热门榜」。
- **语言 / 编码筛选**：搜索页两组胶囊（`langs` 资源取 `/json/languages` 里站点数最多的 10 个，
  编码固定 MP3/AAC/AAC+/OGG），值进 `feed("search", "", applied, want, lang, codec)` 的参数与缓存 key。

## Craft notes

- 玻璃上只有两种颜色：单色文字/符号 + 一个强调色（蓝色主按钮、选中 tab）。`LIVE` 的红色只作状态色，
  且不在玻璃上铺底 —— 「把品牌色留给主操作与状态」（`liquid-glass.md › Color on glass`）。
- 两条浮动栏同一套几何：左右 12、圆角 30/20、投影各一层，视觉上是一组层，而不是两条横条。
- 列表去掉 `border-top`，玻璃自己会画边缘；`-exact-separator` 只留在列表行之间。
- 首屏有 5 行时才滚动；宽窗下内容列 `max-width: 47.5rem` 居中，浮动栏 `max-width: 36rem` 居中。

## What works（保持）

- Hero 渐变卡（深蓝→墨绿）+ 金色描边图标：它是**内容**，正是玻璃要映的对象。
- 胶囊分组、52pt 封面两行列表、空状态的「去发现」按钮：层级清楚，点击区够大。
- 播放面板的大封面（292pt）+ LIVE 胶囊 + 76pt 主按钮：主操作只有一个，符合「一屏一两个强调按钮」。

## Platform notes

| 端 | 玻璃怎么来 | 实测 |
| --- | --- | --- |
| iOS 26 | `backgroundMaterial="glass"` → `UIGlassEffect`；`regular` 用于迷你条 | 截图 g8：行从栏下滚过、模糊可见 |
| macOS 26 | `NSGlassEffectView`；只采样父层子树，玻璃必须是被覆盖内容的直接兄弟 | 截图 g10（需 `screenshot … window` 才看得到材质） |
| Web / Linux | `backdrop-filter="blur(24px) saturate(1.4)"` | 截图 g12：透明 + 模糊边 |
| 全端 | `-exact-scroll-edge-effect` 只有 Apple 端实现，网页会报 `no CSS lowering` 警告（无害） | — |

已知限制：iOS 的 `env(safe-area-inset-*)` 只有 `viewport-fit="cover"` 才非零，而 cover 会让 macOS 整窗白屏
（框架 bug）。所以 tab 栏固定在距底 24pt，而不是贴在 Home 指示条上；等 cover 修好后再改成真正贴底。
