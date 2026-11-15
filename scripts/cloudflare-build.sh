#!/usr/bin/env bash
# Cloudflare Pages build: clone the Exact SDK at the pinned commit, then build the web app.
# Runs from the repo root; output lands in airwave/dist (Pages' destination dir).
set -euo pipefail

SDK_COMMIT="3c68d371becb3fd3efa797f96764fc8535e7308a"
SDK_DIR="$PWD/.exact-sdk"

if ! command -v bun >/dev/null 2>&1; then
  echo "installing bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

echo "cloning expo/exact @ $SDK_COMMIT"
rm -rf "$SDK_DIR"
git init -q "$SDK_DIR"
git -C "$SDK_DIR" remote add origin https://github.com/expo/exact.git
git -C "$SDK_DIR" fetch -q --depth 1 origin "$SDK_COMMIT"
git -C "$SDK_DIR" checkout -q FETCH_HEAD

echo "installing the SDK's own dependencies"
(cd "$SDK_DIR" && bun install --frozen-lockfile)

echo "building the web app"
cd airwave
EXACT="$SDK_DIR" bun exact.mjs web-build --out dist

# Cloudflare Pages reads `_redirects` from the output directory: file first, then the
# app's shell for every other page (200), so /tag/jazz and friends deep-link fine.
cp ../deploy/_redirects dist/_redirects

echo "built: $(du -sh dist | cut -f1) in $(pwd)/dist"
