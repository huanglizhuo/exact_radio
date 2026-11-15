# Airwave — 用 Exact + radio-browser 做的三端网络电台

一份 Contract 同时出 **Web / iOS / macOS**，数据来自 [radio-browser.info](https://www.radio-browser.info/)（5.2 万个公开电台）。只播 https 流。

## 目录

| 路径 | 内容 |
| --- | --- |
| [airwave/](airwave/) | 应用本体：`app.contract`（视图）、`app.ts`（数据模块）、`app.json`（清单）、`app.test.contract`（交互测试） |
| [docs/01-research-exact.md](docs/01-research-exact.md) | Exact 框架深度调研：渲染模型、Contract 语言、音频/媒体会话/后台播放、网络与 ATS 限制、与 RN/Flutter/Tauri 的对比 |
| [docs/02-research-radio-browser.md](docs/02-research-radio-browser.md) | radio-browser API 实测：规模、端点、字段、数据质量（2000 条样本统计）、性能、许可与礼节、没有的东西 |
| [docs/03-plan.md](docs/03-plan.md) | **实现计划**：产品范围、架构、数据层、持久化、播放器状态机、跨平台差异矩阵、P0–P3 里程碑与验收、风险、决策记录 |
| [docs/04-build-log.md](docs/04-build-log.md) | 实现记录：Contract 语法踩坑、工具链补丁、三端布局经验、验证方式 |
| [docs/05-ui-redesign.md](docs/05-ui-redesign.md) | **UI/UX 重构**：同类 app 调研（Sonos / TuneIn / iHeartRadio / Radio Garden / iOS 26 Liquid Glass）、新信息架构、首页与播放面板规格、设计令牌、与第一版的对照 |
| [docs/06-hig-review.md](docs/06-hig-review.md) | **Liquid Glass / HIG 复核**：按 apple-design-skill 的五镜流程逐条对照，列出已修（浮动玻璃栏、regular 材质的迷你条、44×44 触控目标）与待办（面板改 sheet、辅助功能设置复核、macOS 快捷键） |

原始调研材料（下载的 Exact 文档、样本数据）在 `.research/`；Exact SDK 在 `.extern/exact`；工具链在 `.tools/`（`source .tools/env.sh` 后用 `bun`）。

## 跑起来

```sh
source .tools/env.sh
cd airwave
bun exact.mjs web          # 浏览器开发循环
bun exact.mjs test web     # 交互测试
bun exact.mjs mac --run    # macOS 原生
bun exact.mjs ios --run    # iOS 模拟器
```

## 现在到哪一步

三端都能跑：Web（`bun exact.mjs web-build` → `target/web-dist`，11 个交互测试通过）、macOS（`Airwave.app`，`bun exact.mjs mac --run`）、iOS 模拟器（`bun exact.mjs ios --run`，`agent ios --sim "iPhone 17"`）。UI 已按 [docs/05-ui-redesign.md](docs/05-ui-redesign.md) 重做、并按 [docs/06-hig-review.md](docs/06-hig-review.md) 补上 Liquid Glass（底部导航是浮动玻璃胶囊，内容从栏下滚过）：三个 tab（发现 / 正在播放 / 收藏，启动落在「正在播放」）+ 推入式搜索页+ 推入路由（热门榜 `/popular`、收音机 `/radio`、类型与国家），首页有随机收听 hero、继续收听横滑卡片、带标题的榜单与胶囊分组，播放面板换成「大封面 + LIVE + 三键 + 音量」。已实现：**收音机（模拟调谐盘，转旋钮随机换台）**、热门榜、标签/国家浏览、搜索（350ms 防抖 + 请求竞态保护）、**分页加载（每页 40 条，滚到底自动续、列表下方还有「加载更多」兜底）**、**语言 / 编码筛选**、**播放失败自动换台（最多两次）**、**播放面板是真正的 sheet 路由（`/now`，可下拉关闭）**、**搜索历史（最近 8 条）**、收藏与最近收听（`app:/data` JSON）、点播/暂停/上下台、**音量滑杆**、播放面板、Media Session（锁屏与控制中心元数据）、错误码提示、重试与「换一个」、**1024px 应用图标**。截图在 `.research/shots/`（改版后：Web `g3.png` 首页、`g4.png` 播放面板；iOS `g8.png` 玻璃栏 + 迷你条；macOS `g10.png` 需截窗口才看得到材质）。

未做（P2 之后）：语言/编码筛选、失败流自动跳过（现在是手动「换一个」）、商店截图素材、iOS 真机签名（`DEVELOPMENT_TEAM`）与 Mac 公证（`bun exact.mjs release`）。

## 三句话结论

1. **功能可行**：Exact 的 `audio` 元素 + Media Session + iOS `audio_session: playback` 覆盖了"长音频流 + 后台 + 锁屏 + 媒体键"，这正是电台 App 的全部核心。
2. **后端可省**：radio-browser 的 CORS 全开，浏览器与原生都能直连；热门榜 3000 条只有 3.4 MB，可以随包做种子数据。
3. **风险在平台差异与框架成熟度**：只播 https 后约 64.7% 的台可用（http 台不展示），HLS 台在 Web 上播不了；Exact 是 pre-1.0 且无三方 SDK 生态，所以先做 P0 技术验证再铺功能。
