#!/usr/bin/env bash
# Build Airwave's static web app and sync the copy Cloudflare Pages serves.
#   ./scripts/publish-web.sh            build, refresh web/, and leave it staged for git
#   ./scripts/publish-web.sh --no-web   only airwave/dist (for netlify/vercel/nginx uploads)
#
# Cloudflare Pages serves `web/` from this repo (destination_dir=web, no build command):
# its builder has Bun but no cargo, and the web build asks cargo for the wasm arm, so the
# build runs here and the output is committed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/.tools/env.sh"

cd "$ROOT/airwave"
bun exact.mjs web-build --out dist
# NB: keep `.exact-build.json` — `bun exact.mjs serve dist` reads it to know this is a build.

cp "$ROOT/deploy/_redirects" dist/_redirects
# No 404.html in the Pages copy: Cloudflare Pages honours `_redirects`, and a stray
# 404.html next to it is what made deep links answer 404 after the 4a3227e deploy.
case "${1:-}" in
  plain|github) cp dist/shell.html dist/404.html ;;  # hosts without rewrites
esac

if [ "${1:-}" != "--no-web" ]; then
  rm -rf "$ROOT/web"
  cp -R dist "$ROOT/web"
  cd "$ROOT"
  git add -A web
  echo
  echo "web/ refreshed ($(du -sh web | cut -f1)) and staged. Commit + push to deploy:"
  echo "  git commit -m 'web: rebuild' && git push"
fi

echo
echo "dist/ is ready too — upload it anywhere static, or:"
echo "  cd airwave && bun exact.mjs serve dist   # local check with a host's rules"
