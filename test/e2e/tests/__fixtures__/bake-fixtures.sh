#!/bin/sh
set -eu

install() {
  step="$1"
  shift
  echo "[bake] $id: $step" >&2
  npm install --no-audit --no-fund --loglevel=error --min-release-age=1 "$@"
}

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  install 'npm install the registry dependencies'
  install 'npm install the workspace closure tarballs' "$@"
done
