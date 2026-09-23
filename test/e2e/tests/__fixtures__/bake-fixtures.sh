#!/bin/sh
set -eu

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  echo "[bake] $id: npm install the registry dependencies" >&2
  npm install --no-audit --no-fund --loglevel=error
  echo "[bake] $id: npm install the workspace closure tarballs" >&2
  npm install --no-audit --no-fund --loglevel=error /packs/*.tgz
done
