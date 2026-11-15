#!/usr/bin/env bash
# Build Airwave's static web app and package it for a static host.
#   ./scripts/publish-web.sh              → airwave/dist, ready for Cloudflare Pages / Netlify
#   ./scripts/publish-web.sh netlify      → also drops deploy/_redirects into dist
#   ./scripts/publish-web.sh vercel       → also drops deploy/vercel.json into dist
#   ./scripts/publish-web.sh plain        → no host file (nginx / S3 / GitHub Pages)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/.tools/env.sh"
TARGET="${1:-netlify}"

cd "$ROOT/airwave"
bun exact.mjs web-build --out dist

# NB: keep `.exact-build.json` — `bun exact.mjs serve dist` reads it to know this is a build.

case "$TARGET" in
  netlify|cloudflare|cf) cp "$ROOT/deploy/_redirects" dist/_redirects ;;
  vercel)               cp "$ROOT/deploy/vercel.json" dist/vercel.json ;;
  plain)                : ;;
  *) echo "unknown target: $TARGET (use netlify|vercel|plain)" >&2; exit 2 ;;
esac

# GitHub Pages has no rewrites: copy the shell to 404.html so deep links still boot.
if [ "$TARGET" = "plain" ]; then cp dist/shell.html dist/404.html; fi

echo
echo "dist/ is ready ($(du -sh dist | cut -f1)). Upload it, or:"
echo "  bun exact.mjs serve dist        # local check with the same rules a static host applies"
