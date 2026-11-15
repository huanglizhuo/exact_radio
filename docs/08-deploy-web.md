# 把 Airwave 发布成 Web 应用

## 一句话

`exact` 的 Web 产物是**纯静态站点**：一个 `index.html`、一个 `app.js`、若干按需加载的 `*-glue*.js`、
`manifest.json`、图标和一份路由表。把它丢到任意静态托管上就行 —— 唯一必须自己配的是**深链 fallback**。

## 构建

```bash
cd /Users/lizhuo/owork/e-asr
./scripts/publish-web.sh            # 默认按 Cloudflare Pages / Netlify 打包
./scripts/publish-web.sh vercel     # 加 vercel.json
./scripts/publish-web.sh plain      # 只出静态文件（nginx / S3 / GitHub Pages）
```

脚本做两件事：`bun exact.mjs web-build --out dist`、按托管商放一份 fallback 配置。产物约 **3.2MB**
（20 个文件还额外压了 brotli + gzip）。**别删 `dist/.exact-build.json`** —— `bun exact.mjs serve dist`
靠它认出「这是一个构建产物」，删了会报 `no build in …dist`。

想本地按「静态主机的规则」验证：

```bash
cd airwave && source ../.tools/env.sh && bun exact.mjs serve dist --port 8791
```

实测（`curl -H "Accept: text/html"`）：`/`、`/tag/jazz`、`/country/DE`、`/search`、`/radio`、`/now`、`/favorites`
全部 **200**（回 `shell.html`），`/manifest.json` 200，`/nope` **404**。

## 唯一的坑：深链要回落到 shell.html

`dist/routes.json` 里 10 条路由全是 `render: client`，其中 `/tag/:tag`、`/country/:code` 是**无界动态路由**，
没法预渲染。静态主机的正确规则是：

> 路径上有文件就发文件；否则对浏览器的页面导航回 **`shell.html`（状态 200）**，由客户端路由画出对应页面。

各家的写法（`deploy/` 里都有现成的）：

| 托管 | 做法 |
| --- | --- |
| Cloudflare Pages / Netlify | 放一份 `_redirects`：`/*  /shell.html  200` |
| Vercel | `vercel.json` 的 `rewrites: [{ "source": "/(.*)", "destination": "/shell.html" }]` |
| GitHub Pages | `cp dist/shell.html dist/404.html`（没有 rewrite 能力，靠 404 页启动） |
| nginx | `location / { try_files $uri /shell.html; }` |
| S3 + CloudFront | 把「错误文档」设为 `shell.html`、响应码 200（或用 CloudFront Function 重写） |

## 部署动作

- **Cloudflare Pages**：`npx wrangler pages deploy dist --project-name airwave`（或控制台拖 `dist`）。
- **Netlify**：`npx netlify deploy --prod --dir dist`（`_redirects` 会被识别）。
- **Vercel**：`npx vercel deploy --prod dist`。
- **自己的服务器**：把 `dist` 拷过去，按 `deploy/nginx.conf` 配一段 `try_files`。

## 上线前确认

- **HTTPS 必须**：应用只播 `https://` 的流，且 Media Session / PWA 安装都要求安全上下文。
- **PWA**：`manifest.json` 已经是 `display: standalone` + 1024px maskable 图标 + `theme_color`；
  `app.json` 的 `host.web.head` 里补了 `apple-mobile-web-app-capable` 等标签，iOS「添加到主屏幕」会以独立窗口打开。
  **没有 service worker**，所以没有离线能力，Chrome 也不会弹安装条 —— 需要离线就自己加一个（`dist` 是普通静态目录，加文件即可）。
- **缓存**：`app.js` 与 `*-glue-*.js` 名字里带 hash，可以 `immutable` 长缓存；`index.html` / `shell.html` 建议短缓存。
- **数据**：电台列表来自 `radio-browser.info`（CORS 开放）、底图来自 Esri 瓦片，全部在运行时请求，服务端零依赖。

## 已配置好的：Cloudflare Pages + GitHub 自动部署

- 仓库：https://github.com/huanglizhuo/exact_radio（`main`）。
- Pages 项目：`airwave`，生产地址 **https://airwave-76y.pages.dev**（以后可绑自定义域名）。
- 连接方式：Pages 的 Git 集成（Cloudflare 的 GitHub App），**push 到 `main` 就自动部署**。
- 构建配置（在项目里已经设好）：`build_command` = 空、`root_dir` = 仓库根、`destination_dir` = **`web`**。
  也就是说 Pages 不做构建，只上传仓库里的 `web/` 目录。

### 为什么构建放在本地

Cloudflare 的构建镜像里有 Bun，但**没有 cargo**；`bun exact.mjs web-build` 会调
`cargo metadata --locked --offline` 找 wasm arm，于是 CI 里报
`web build: cargo metadata …: Executable not found in "$PATH": "cargo"`。
所以流程是：**本地构建 → 把产物提交到 `web/` → push → Pages 自动上传**。

```bash
./scripts/publish-web.sh           # 构建 dist、刷新 web/、把 web/ 加进暂存区
git commit -m "web: rebuild" && git push origin main
# 想手动触发一次部署（不推代码）：Pages 项目 → Deployments → Retry/Deploy，或
npx wrangler pages deploy web --project-name airwave --branch main
```

### SPA 回落

`web/_redirects` 是 `/*  /index.html  200`。**不要**写 `/shell.html`：Pages 会对 `.html` 目标做
「pretty URL」308 跳到无扩展名路径，结果把自己跳成死循环（我踩过一次，整站 308 到 `/shell`）。
`/index.html` 是 Pages 特判的 SPA 写法，深链（`/tag/jazz`、`/country/DE`、`/now`）都能直接进客户端路由。
