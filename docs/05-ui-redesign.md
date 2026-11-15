# Airwave UI/UX 重构（v2）

第一版的评价是「交互太糟糕」：四个 tab 里塞了一个玩具页，首页是三排没有标题的长列表，播放面板是一张空白页加两个按钮。这一版按「先看别人怎么做」重来。

## 1. 调研：同类 app 在做什么

| 来源 | 学到的 |
| --- | --- |
| [Sonos "Now Playing" 案例](https://dribbble.com/shots/24700723-Now-Playing-Colors) | 播放页是「英雄时刻」：让封面占据视觉中心，颜色从封面延伸出去，而不是堆控件。 |
| [Design Lounge：iOS now playing 规格](https://www.designlounge.live/p/ios-now-playing) | 封面 ~326px 圆角 14、背景是同一张封面放大 + `blur(48px) saturate(140%)` 再自上而下压暗；控制区 Previous / Play / Next + 音量滑杆 + 一个玻璃「更多」。 |
| [对 TuneIn 首页的批评](https://www.linkedin.com/posts/gnkumar1106_uxdesign-productdesign-uxcasestudy-activity-7444822505653112832-I5qj) | 三个**没有标题**的横向 carousel、行间距 7px —— 用户根本不知道每行是什么。修法：每个 carousel 都有 section header。 |
| [iHeartRadio 改版](https://iheartradio.mx/iheartradio-app-estrenamos-actualizacion-y-nuevas-funciones/) | 四个招牌入口：Memories（常听的台）、Scan（像数字收音机一样扫台）、Live dial、Trending。 |
| [Radio Garden](https://radio.garden/settings/radio-garden?hl=zh-Hans) | 用「地点」当发现维度；Browse 里按国家/城市/风格精选。 |
| [iOS 26 Liquid Glass（WWDC25）](https://developer.apple.com/videos/play/wwdc2025/284/?time=1449) | 系统栏默认透明、按钮带玻璃底、内容从栏下滚过并有 edge effect。**不要**给自绘栏加不透明底去「仿」系统栏。 |

三条可以直接落到代码里的结论：

1. **首页需要层级**：每个横向/纵向区块都有标题，行与行之间留 20px 呼吸。
2. **播放页是英雄页**：大封面 + 大标题 + 一颗主按钮，其他都收进次要位置。
3. **tab 只放「常去的地方」**：发现、搜索、收藏。收音机是一个**玩法**，不是一个目的地 —— 它变成首页的入口。

## 2. 新的信息架构

```
tab 发现  /                       首页：随机收听入口 + 继续收听 + 正在流行 + 类型/国家
  push  /popular                  完整的热门榜（虚拟化 + 滚到底续页）
  push  /radio                    模拟收音机（调谐盘）
  push  /tag/:tag                 类型列表
  push  /country/:code            国家列表
tab 搜索  /search                 搜索 + 最近搜索 + 推荐分类
tab 收藏  /favorites              收藏列表 / 空态
```

- 三个 tab，四个推入路由。推入路由都有可见的返回按钮（`symbol:back`）。
- 收音机从 tab 降级成首页的两种入口：标题右侧的圆钮 + 深色 hero 卡。
- 播放面板不是路由：它是盖在所有 tab 之上的覆盖层，播着什么都不会因为切 tab 而消失。

## 3. 首页

```
发现  五万个电台，随便挑一个            ⚪(波形钮 → /radio)
┌─────────────────────────────────────────┐
│ ♪ 随机收听                          >   │   深色渐变卡（#101A33 → #0B3A4A）
│   像老式收音机那样转一下，换一个从没听过的台 │
└─────────────────────────────────────────┘
继续收听
[封面 116]  [封面 116]  [封面 116]  …        横向，最近 20 台
正在流行                            查看全部 >
[52] Christmas FM Non-stop!                 竖排 5 行
     Finland · advent · canti natalizi
…
按类型
(jazz) (classical) (news) (rock) (pop) …
按国家
(美国) (英国) (德国) (法国) (日本) …
```

- 「继续收听」只在有历史时出现；卡片宽度 116、双行标题（`line-clamp=2`）。
- 「正在流行」取 `discoverList.slice(0, 5)`，正在播的那一行右侧有波形图标。
- 区块标题 `-exact-title3` + 600，行内说明 `-exact-footnote` + 次要标签色。
- 整个首页是一个 `scroll` 容器（不是虚拟列表）：区块高度固定、总量很小。

## 4. 列表页（/popular、/tag、/country、/search 结果、/favorites）

统一的「一行一台」：

| 元素 | 规格 |
| --- | --- |
| 封面 | 52×52，圆角 10；没有 favicon 时用灰底 + `symbol:radio` |
| 主标题 | `-exact-body` 500，`line-clamp=1` |
| 次行 | `国家 · 类型…`，`-exact-footnote`，次要标签色，`line-clamp=1` |
| 右缘 | 正在播 → `symbol:waveform`（强调色）；收藏页 → `symbol:star-fill`（系统黄） |
| 分隔 | `border-bottom: 1px solid -exact-separator`，行内 padding 7/16 |
| 分页 | `list virtualized=true estimated-item-height=66 reachend=loadMore reach-margin="60%"`，滚到底自动续 40 条 |

## 5. 播放面板

```
‹ 收起            正在播放            停止
          ┌───────────────┐
          │               │   292×292，圆角 26，
          │     封面       │   阴影 0 22 44 rgba(8,16,30,.32)
          └───────────────┘
             Radio Armisa            -exact-title2 700
        Italy · anni 80 · anni 90     次要标签色
              (LIVE) MP3              红色胶囊 + 编解码

           (★)      (▶ 76)      (→)    收藏 / 主按钮 / 下一台

        🔊 ─────────────── 🔇          音量
        🌙 睡眠定时   (15 分钟)(30 分钟)(60 分钟)
```

- 面板铺满窗口，顶部一条 45% 高的中性渐变（`rgba(12,22,40,.10)` → 透明）当氛围，封面自带阴影承担「英雄」。
- 主按钮 76pt 圆形、`AccentColor` 底、图标用 `-exact-background` 反白。
- 失败时在标题下插入错误卡：`播放失败（network）` + 重试 / 换一台。
- iOS 上 tab 栏是平台画在内容之上的，所以面板底部留 76pt，睡眠行不会被切。

**试过但放弃**：用封面本身当氛围层（`opacity=0.12` + `filter="blur(56px)"`）。web 上是标准做法，但 `filter` 在 AppKit/UIKit 上不生效，未模糊的放大封面在 macOS 上变成一条突兀的色带。跨端一致优先，改成中性渐变。

## 6. 迷你播放条 与 tab 栏

```
[40 封面] Radio Armisa            (LIVE) (⏸)
          Italy · anni 80 · anni 90
─────────────────────────────────────────────
  ⌂ 发现          ⌕ 搜索          ☆ 收藏
```

- 迷你条：40pt 封面、双行、右侧 LIVE 胶囊（播放中红色 / 暂停灰）与播放键；整条左半区可点开面板。
- tab 栏：自绘、`height=56`、顶部一条分隔线；图标 22pt + `-exact-caption2` 文字；选中项用 `AccentColor`；宽窗时每个按钮 `max-width=12rem` 居中。

## 7. 设计令牌

| 用途 | 取值 |
| --- | --- |
| 内容列宽 | `max-width: 47.5rem`，`margin-inline: auto`（桌面居中，手机满宽） |
| 页面左右内边距 | 16 |
| 区块间距 | 20（首页 `column gap`） |
| 区块标题 | `-exact-title3` / 600 |
| 页面大标题 | `-exact-large-title` / 700 |
| 卡片圆角 | 22（hero）/ 14（封面）/ 10（列表缩略图） |
| 强调色 | `AccentColor`；LIVE 用 `-exact-system-red` |
| 描边 | `1px solid -exact-separator` |

## 8. 这一版改了什么（对照第一版）

| 第一版 | 第二版 |
| --- | --- |
| 4 个 tab，收音机占一个 | 3 个 tab，收音机变成首页入口 + 推入路由 |
| 首页是三排无标题长列表 | 标题 + hero + 横向卡片 + 竖排 5 行 + 胶囊分组 |
| 列表行 40pt 图 + 单行文字 | 52pt 图 + 主次两行 + 播放态波形 + 分隔线 |
| 播放面板是一张白页 | 大封面 + LIVE + 三键控制 + 音量 + 睡眠 |
| 播放条是灰底一行字 | 封面 + 双行 + LIVE 胶囊 |
| 所有页面共用 `padding 16`，桌面贴左 | 统一 47.5rem 居中列 |
