# 09 · 世界页升级为「地球仪」：调研与实施计划

> 状态：**计划**（用户明确「先制定计划，不要直接改代码」）。本文不含任何已落地的代码改动。

## 0. 目标

把世界页的平面瓦片地图升级成 gradio.clothpath.com 那样的 **3D 地球仪**：

- 整个地球以深色球体呈现，**所有电台以圆点铺在球面上**；
- 拖动旋转地球、滚轮/双指缩放；
- 转到某处松手后，**自动定位并播放离视图中心最近的电台**；
- 点任意圆点直接播那一台。

## 1. 参考实现拆解（gradio.clothpath.com，实测于 2026-11-16）

抓原始 HTML + 反查 bundle（`assets/index-BNPlTu4C.js`、`vendor-maplibre-C6wSVps4.js`）：

| 维度 | 事实 |
| --- | --- |
| 渲染 | **MapLibre GL JS v5.9.0**，`setProjection({type:"globe"})`，站点用 **circle layer** 画（`circle-radius` 出现 9 次） |
| 配色 | 深色主题 `#0b0d14`；圆点绿 `#10b981` + 蓝 `#3b82f6`（蓝=正在播/选中类，绿=普通站点） |
| 全量数据 | `stations/search?limit=N&order=votes&reverse=true&has_geo_info=true&hidebroken=true` 拉一批进缓存（`fetchAllStations` → `applyGlobeStations`），无实时逐点请求 |
| 最近台 | 松手时 `stations/search?geo_lat=&geo_long=&geo_distance=500000&limit=200&order=votes&reverse=true&has_geo_info=true&hidebroken=true`（**固定 500km 半径、limit 200**，`jt=500`、`×1e3` 转米），再**本地 haversine 排序取最近** |
| 其它 | 另有按 tag/name 的搜索；无账号 |

结论：gradio 的「最近台」也要靠一次 API 往返（500km/200 条），因为它不保证全量在内存里可算。我们可以做得更好（见 §3.3）。

## 2. 方案对比：地球仪用什么画

硬约束：**一套代码跑 web / iOS / macOS / Android 四端**，Exact 没有 WebView 逃逸舱（`hatch` 是原生代码接入，不是网页嵌入）。

| 方案 | 原理 | 四端? | 结论 |
| --- | --- | --- | --- |
| **MapLibre GL JS**（gradio 同款） | WebGL globe + circle layer | ❌ 仅 web（WebGL/DOM） | 排除。它是网页应用的正确选择，正是我们要超越的地方 |
| CesiumJS / three-globe / globe.gl | WebGL/Three.js | ❌ 同上 | 排除 |
| MapLibre + 原生 SDK（MapLibre Native） | 各端原生地图引擎 | ⚠️ 需每端嵌原生依赖，Exact 无此接线 | 排除 |
| **D3（d3-geo orthographic）+ Canvas 2D** | 纯 JS 投影数学 + 2D 画布 | ✅ | 备选。d3-geo 只提供投影函数，我们已有自写 Mercator 经验，正交投影 20 行可自写，**不值得引依赖** |
| **Exact `canvas surface=` + 数据模块 Canvas 2D（自绘）** | 见 §3 | ✅ 全部 | ✅ **采用** |
| Exact GPU module（wgpu/Rust） | 真 3D/GPU | ✅ | 杀鸡用牛刀：点阵地球是 2.5D（正交投影无透视），Canvas 2D 足够；还引入 Cargo workspace/wasm-bindgen 版本钉死等构建复杂度 |

**为什么自绘可行（SDK 事实，均已核实）**：

- `canvas surface=name(args)` 节点绑定数据模块里的绘制函数，**args 变化即重绘**；`draw(surface, args, ctx, frame)` 返回 `true` 还能要下一帧（动画用）。
- `Ctx2D`（SDK `canvas/types.d.ts`）是标准 Canvas 2D 子集：路径/arc/ellipse、fill/stroke、**线性和径向渐变**（大气辉光）、`globalAlpha`（点聚合热度）、`shadowBlur`（选中光环）、transforms、`fillText/measureText`（标注）、`drawImage`。**四端同一 API**，Apple 端走 vello GPU 渲染（我们已打过 metallib 补丁，即为此路径）。
- canvas 节点收 `pointerdown/move/up`（带 `offsetX/Y`、`pointerId`——现有瓦片地图的双指缩放已用同一套）和 `wheel`（`deltaY` 缩放；触控板捏合 = `ctrlKey`+deltaY）；`touch-action="none"` 后触摸不触发页面滚动。
- 数据模块可以有模块级缓存（现有 feed LRU 就是），站点数据集放模块内存，surface args 只传轻量标量（中心经纬度、缩放、选中 id），每帧重绘不重复传大数据。
- `captureCanvas(surface, path)` 可把画布存 PNG——测试与截图验收用。

## 3. 架构设计（采用方案：canvas 自绘正交投影地球仪）

### 3.1 数据层：全量站点数据集

实测（de1 节点，2026-11-16）：

- `limit=20000` → **502 Bad Gateway**（服务端截断）；`limit=8000` 成功：**10MB 原始 JSON、12s**。
- 裁剪字段（uuid/name/url_resolved/geo_lat/geo_long/favicon/codec/bitrate/countrycode/首 tag）后 **1.88MB**，gzip **0.84MB**（传输体积）。

设计：

1. **分块拉取**：每块 `limit=2500&offset=…&order=votes&reverse=true&has_geo_info=true&hidebroken=true&is_https=true`，逐块进 globe；返回不足 2500 行即停。块到达即上屏（地球渐次变亮，天然进度反馈），不用等全量。
2. **持久缓存**：合并后写 `app:/cache/globe.json`（裁剪后的紧凑数组，grants 加 `fs.write app:/cache`），下次启动秒出。**无 TTL**——数据源禁 `Date.now()`（确定性环境，`analyze-ambient-api`），改为显式「刷新」按钮 + 失败不覆盖旧缓存。
3. **内存形态**：模块级 `Float64Array`（lat/lon 各一）+ 平行 `Station[]`（点击与播放用），8-14k 行在 Hermes 64MB 堆下约 4-6MB，安全。
4. 预计总量：带 geo 的 https 未断站 **约 0.8-1.2 万**（8000 名开外 votes 已为 0；实现时以分块自然终止为准，不预设总数）。

### 3.2 渲染层：正交投影绘制管线

投影：标准 orthographic（中心 λ0/φ0 + 缩放 R），正/反变换各 ~20 行纯函数，与现有 Mercator 同居 `app.ts`。

每帧绘制顺序（深色主题对齐 gradio：底 `#0b0d14`）：

1. **海洋圆盘**：径向渐变深蓝黑球体；
2. **经纬网**：每 30° 的淡网格线（增强立体感，替代瓦片地图的地理参照）；
3. **陆地轮廓**：Natural Earth 110m land（公有领域），预处理成量化整数折线（delta 编码，预计 60-80KB）内嵌资产文件；填充暗灰绿 + 描边，**每帧重投影**（110m 只有 ~5k 折线点，成本可忽略）；
4. **站点圆点**：背半球剔除（`cos(c)=sinφ0·sinφ+cosφ0·cosφ·cos(λ-λ0) > 0` 才画）；
   - 低缩放（globefit）：**6px 网格聚合**，格子内点数 → 半径/透明度（欧洲密集区不糊成实心）；
   - 高缩放：逐点 2.5px 圆 + 正在播/最近台特殊态（蓝 `#3b82f6` + 光环，普通绿 `#10b981`）；
5. **中心十字标**：视图中心的准星（「松手播最近」的靶心暗示）；
6. **大气辉光**：球盘外缘一圈径向渐变淡光。

动画：启动后未交互时缓慢自转（`draw()` 返 `true` 逐帧，`Frame.time` 驱动），首次触摸即停——首屏即「活的」。

### 3.3 交互层：旋转、缩放、最近台、拾取

- **拖动旋转**：pointermove 累积 Δ → 更新 `globeLat/globeLon` state → surface args 变化重绘（与现有瓦片地图同机制，现有四端已验证流畅）。纬度钳制 ±85°。
- **缩放**：wheel/pinch 改 `globeZoom`（R 的倍率，1x-32x），缩放中心跟随指针/捏合中点。
- **松手 → 最近台（核心交互，替代 gradio 的 API 往返）**：全量数据在内存 → **本地 haversine 全扫**（1 万次三角函数 ≈ 个位数毫秒，无网络往返，比 gradio 更快且精确）→ 命中即 `play()`；同时底部弹「这一带」卡片列出 top 8（复用现有卡片与 widenArea 逻辑，作为数据集未覆盖区域时的 API 兜底）。
- **点击拾取**：pointerup 无拖动位移时走 source `globe-pick`，把 (x,y,λ0,φ0,R) 交数据模块逆投影 → 最近站点 id 返回 → 播放并高亮。投影数学只在模块里存一份。
- **自动播放开关**：默认开（用户要的「滚动定位到最近的电台播放」）；面板提供开关，关掉后松手只弹卡片不播。

### 3.4 与现有世界页的关系

- **方案 A（推荐）**：地球仪**整个替换**瓦片地图，成为世界页唯一视图。删 Esri 瓦片逻辑（约 -80 行 app.contract + 瓦片 state），「这一带」卡片/扩半径/飞行动画保留复用。理由：地球仪本身就是地理浏览；两套地图切换徒增复杂度。
- 方案 B（备选，未来增强）：低缩放地球仪、高缩放（>8x）淡入现有 Esri 瓦片看街道。正交高缩放 ≈ 局部平面图，理论上可无缝拼接，但跨投影插值是硬骨头，**不进首版**。

## 4. 阶段划分

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0 静态地球** | 数据层（分块拉取+缓存+刷新按钮）；surface `globe` 绘制管线（海洋/网格/陆地/圆点）；启动自转 | 四端截图：深色球 + 8k 圆点 + 陆地轮廓；`captureCanvas` 比对 |
| **P1 交互** | 拖动旋转、wheel/双指缩放、松手本地最近台自动播放、点击拾取播放、「这一带」卡片接入 | agent web 拖到太平洋孤岛 → 播最近台；点圆点播指定台；iOS/macOS/Android 手动验证 |
| **P2 打磨** | 聚合热度渲染、选中光环与飞行动画、自动播放开关、低电量端性能（聚合粒度自适应）、刷新按钮、README/文档更新 | 60fps 拖动（web dev trace `perf frames`）；低端场景（8k 点全量）Android 真机可拖 |

## 5. 性能预算与风险

| 风险 | 评估 | 缓解 |
| --- | --- | --- |
| 万级圆点每帧 canvas 2D | 背半球剔除后 ~一半；聚合后低缩放实际绘制 ≤2k 圆 | vello(Apple)/Skia(web) 都吃得住 fillRect/arc 批量；实测不行就改 `putImageData` 点阵（types.d.ts 已含） |
| state→args→重绘链路延迟 | 与现有瓦片地图同机制（每 pointermove 重排一次），四端已验证 | 不新增风险；必要时拖动中降采样、松手全量 |
| 首次拉取 12s/10MB | 分块渐进上屏 + 磁盘缓存二次启动秒出 | 失败保留旧缓存；WiFi 场景可接受 |
| `Bad Gateway`（大 limit） | 已实测 | 固定 2500/块分页，自然终止 |
| Hermes 64MB 堆 | 8-14k 行结构化 ~6MB | 数值列用 TypedArray，不存冗余字段 |
| 正交投影在两极 | 纬度钳 ±85°，网格线极区收敛 | 纯数学，无依赖 |
| 数据源确定性（禁 Date.now） | 已知约束 | 无 TTL，显式刷新 |

## 6. 测试计划

- `app.test.contract`：分块合并逻辑（feed 假服务器）、松手最近台选择（本地扫描 vs 卡片列表一致性）、自动播放开关、pick 逆投影（假 args 返回固定 id）。
- `bun exact.mjs test web` 全绿后：`agent web` 拖动 + `screenshot` 四方向旋转、缩放档位、点圆点播放；`captureCanvas` 存基准 PNG。
- iOS/macOS 模拟器 + Android 真机各跑一遍 P1 验收脚本（复用现有 `sim-use` 流程）。

## 7. 工作量估算

- P0：数据层 + 绘制管线 ≈ **半天**（含陆地资产预处理脚本）。
- P1：交互 + 最近台 + 拾取 + 卡片接入 ≈ **半天**。
- P2：打磨 + 四端验证 + 文档 ≈ **半天**。
- 合计约 1.5 个工作日。

## 8. 决策点（默认按推荐执行，可否决）

1. **替换 vs 共存**：推荐 A（地球仪替换瓦片地图）。
2. **自动播放最近台**：默认开，可关。gradio 是默认播；用户原话「滚动地图定位到最近的电台播放」即此行为。
3. **配色**：对齐 gradio 深色（`#0b0d14` 底 + 绿/蓝点）还是 App 现有亮色主题？推荐**地球仪局部深色**（太空语境自然暗），页面其余保持现状。
4. **站点总量**：不设上限（分页自然终止，预计 ≤1.2 万）；若最终过大再按 votes 截断。
