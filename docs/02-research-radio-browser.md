# 调研二：radio-browser.info 数据与 API 实测

> 调研时间：2026-11-15，实测服务器 `https://de1.api.radio-browser.info`。官方文档：<https://api.radio-browser.info/>，代码与反馈在 GitLab（`gitlab.com/radiobrowser/radio-browser-api`）。
> 本地留档：`.research/`（探针脚本与样本数据）。

## 1. 它是什么

社区维护的**开放电台目录**（非营利）。它不转发音频，只提供"电台元数据 + 流地址"；客户端拿到 `url_resolved` 后自己去连流。整套数据可下载、可自建镜像，官方明确允许商业与非商业使用：

> "You may use it in free and non free software. You may install it on your own server and mirror all its data."

### 规模（2026-11-15 `/json/stats`）

| 指标 | 值 |
| --- | --- |
| 电台总数 | **52,666** |
| 被标记 broken | 20 |
| 标签 | 11,141 |
| 语言 | 583 |
| 国家 | 224 |
| 24h 点击 | 235,423 |
| 软件版本 | 0.7.50（Rust + tiny-http） |

对一个 MVP 来说，这个数据量级**不需要自建后端**：全量 station 列表也就几十 MB，热门榜 3,000 条只有 3.4 MB。

## 2. 接入方式（必须先做的一件事：找服务器）

官方要求**不要硬编码单台服务器**，按顺序发现：

1. DNS：`all.api.radio-browser.info`（实测当前只解析到 `de1.api.radio-browser.info`）
2. SRV 记录：`_api._tcp.radio-browser.info`
3. 兜底：`GET /json/servers`（仅当客户端拿不到 DNS 时用）

客户端应**随机化**顺序、失败自动切下一台、并缓存健康的那台（我们计划里用 60 s 级别的内存缓存，不做持久化，避免服务器迁移后卡死）。

### 请求礼节（照做，否则会被封 IP）

- 带**可识别的 User-Agent**：`MyRadioApp/1.0 (+https://example.com)`。⚠️ 浏览器禁止脚本设置 `User-Agent`，所以 **web 端只能用浏览器默认 UA**，在原生端（数据模块 fetch 可自定义 header）才带自定义 UA——这是 P0 要验证的一项。
- 用户**每次点播**调 `GET /json/url/{stationuuid}` 记一次 click（同 IP 同台每天只记一次）。这是这个项目的"回馈方式"，不是可选装饰。
- 响应缓存 60 s（`/json/config` 的 `cache_ttl`），我们的客户端也要遵守。
- 投票走 `GET /json/vote/{uuid}`（同 IP 同台 10 分钟一次）。
- 提交新台走 `/json/add`（带 `name,url,homepage,favicon,countrycode,iso_3166_2,languagecodes,tags,geo_lat,geo_long`）。

### CORS

`access-control-allow-origin: *`，允许的方法 `GET, POST`，允许的头 `origin, x-requested-with, content-type, user-agent`。**浏览器可以直连，不需要代理。**

## 3. 端点清单（我们真正会用到的）

| 用途 | 端点 | 关键参数 |
| --- | --- | --- |
| 搜索/浏览 | `GET /json/stations/search` | `name, nameExact, country, countryExact, countrycode, state, language, languageExact, tag, tagExact, tagList, codec, bitrateMin/Max, has_geo_info, has_extended_info, is_https, geo_lat/geo_long/geo_distance, order, reverse, offset, limit(默认 100000), hidebroken(默认 false)` |
| 热门 | `GET /json/stations/topclick/{N}`、`/topvote/{N}` | N 为条数 |
| 最近点播 | `GET /json/stations/lastclick` | 无 |
| 批量按 uuid | `GET /json/stations/byuuid?uuids=a,b,c` | 收藏列表刷新（一次最多几十个） |
| 按流地址 | `GET /json/stations/byurl?url=` | 从分享链接反查 |
| 筛选词表 | `/json/tags`、`/json/tags/{filter}`、`/json/countries`、`/json/languages`、`/json/codecs` | 做筛选面板 |
| 记点击 | `GET /json/url/{uuid}` | 每次点播 |
| 元信息 | `/json/stats`、`/json/servers`、`/json/config` | 健康检查 / 服务器发现 |

`order` 可用值：`name, url, homepage, favicon, tags, country, state, language, votes, codec, bitrate, lastcheckok, lastchecktime, clicktimestamp, clickcount, clicktrend, changetimestamp, random`，配 `reverse=true` 倒序。

> 同一套数据支持 `xml / csv / m3u / pls / xspf / ttl` 输出格式——导出播放列表（给 VLC/IINA 用户）是几乎白送的功能。

## 4. Station 字段（含实测数据质量）

```
stationuuid  changeuuid  serveruuid
name         url         url_resolved   ← 客户端优先用这个
homepage     favicon     tags(逗号分隔)
country(弃用) countrycode(ISO-3166-1 alpha-2)  state  iso_3166_2
language     languagecodes(ISO 639-2/B)
votes        clickcount(24h)  clicktrend  clicktimestamp
codec        bitrate(kbps 数值)  hls(0|1)  ssl_error(0|1)
lastcheckok(0|1)  lastchecktime  lastcheckoktime  lastlocalchecktime
geo_lat  geo_long  geo_distance  has_extended_info(0|1)
```

### 2000 条随机样本实测（2026-11-15）

| 维度 | 结果 | 对产品的影响 |
| --- | --- | --- |
| `url_resolved` 是 https | **64.7%** | 35% 的台在 iOS 需要 ATS 放宽、在 https 网页会被混合内容拦截 |
| HLS（`hls=1`） | **5.8%**（热门榜单里 10.3%） | web 端 Chrome/Firefox 播不了 |
| 无 favicon | **39.2%** | 必须做占位图（按名字哈希取色 + 首字） |
| favicon 是 http | 有图里 51.8% | 同上，https 页面会被拦 |
| codec | MP3 67.4%、AAC 14.9%、AAC+ 14.2%、OGG 0.9%、UNKNOWN 2.6% | OGG 在 Apple 播不了 |
| bitrate | 128k 40%、0 15%、192k 10%、64k 8.7%、96k 5.4%、320k 5.3% | `0` 不是错误，是"未知" |
| has_geo_info | 19.8% | 地图/附近功能只能覆盖两成 |
| has_extended_info | **0.9%** | 别指望目录帮我们做"正在播放" |

### 数据质量坑（实测看到的原始值）

- 名字有**前导/尾部空格**，也有把描述塞进名字的：`0R - PIANO JAZZ LOUNGE || Jazz, Piano, Easy Listening, …`
- 空名（top3000 里 0 个，随机样本里有）
- `hls=1 & codec=UNKNOWN & bitrate=800` 的条目**多是电视频道**（IPTV 混进了电台目录）
- 同名重复：top3000 里有 **87 个重名**
- `bitrate=0` 普遍存在
- 中文台示例：CNR-1 中国之声 → `https://lhttp.qtfm.cn/live/15318317/64k.mp3`（`bitrate=0`，但流是好的）

结论：**必须在客户端做一层规范化（normalize）**，否则 UI 会很脏。计划里给了一组明确规则。

## 5. 性能实测

| 请求 | 结果 |
| --- | --- |
| `/json/stations/search?limit=20`（冷） | 0.8–1.2 s |
| `/json/stations/search?order=clickcount&reverse=true&hidebroken=true&limit=3000` | **3.4 MB / 3.5 s** |
| `/json/tags` | 数千条，约 200 KB |

启示：
- **首屏不要拉 3000 条**。首屏用 `limit=60`，滚动再 append（offset 分页）。
- 3.4 MB 的热门榜可以**随包内置一份种子快照**（每天/每周手动或 CI 更新），实现"断网也能看到榜"。但注意：内置快照的 clickcount 会过期——只用于首屏兜底，联网后覆盖。
- 搜索必须**防抖 300–400 ms**，否则每次按键 1 s 延迟会很难受。

## 6. 没有的东西（别去找）

- ❌ **没有"正在播放"接口**。想要歌名/节目名，只能：
  1. 读流的 ICY `StreamTitle`（原生端可自写；web 端有 CORS 与自定义头限制，几乎不可能）
  2. 站点自己的 API（`has_extended_info=1` 的 0.9% 才有，格式还是站点自定）
- ❌ 没有节目表（EPG）
- ❌ 没有用户账号 / 跨设备同步（所以要同步只能自己做后端）
- ❌ 没有音频代理/转码（http 台不会自动变 https）

## 7. 许可与合规要点

| 项 | 结论 |
| --- | --- |
| 目录数据 | 允许在免费/商业软件中使用，允许自建镜像 |
| 音频流 | **与目录无关**，版权归各电台；App 只做"播放器"，不做录制/转播，风险低；但要在关于页声明"音频由各电台提供，本应用不存储任何音频" |
| 电台 logo | 直接引用远程 favicon URL，不打包进 App（避免版权与体积） |
| 点击计数 | 每次点播必须调用，属于使用条款 |
| User-Agent | 必须可识别；web 端受浏览器限制需在文档里说明 |

## 8. 对实现的直接结论

1. **不需要自建后端就能做 MVP**：浏览器直连（CORS 已开），原生直连。
2. 服务器发现 + 失败切换 + 60 s 缓存，是数据层的第一个模块。
3. 规范化（trim、去重、过滤疑似电视频道、bitrate=0 → "未知"、favicon 兜底）必须在客户端做，且要有测试。
4. 分页 + 防抖 + 首屏小 limit，是搜索体验的三件套。
5. http 流（35%）是**跨平台最大不一致来源**：web 会拦、iOS 需 ATS、macOS 需 ATS；一期必须给出明确的产品处理（隐藏/标注/降级），二期再考虑 Worker 代理。
6. 没有 now-playing，一期就在 UI 上诚实（显示电台名 + 国家/语言/码率），不要画一个空白的"正在播放"。
