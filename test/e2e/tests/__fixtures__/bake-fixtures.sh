#!/bin/sh
set -eu

INSTALL_LIMIT_SECONDS=300

install() {
  step="$1"
  shift
  echo "[bake] $id: $step" >&2
  status=0
  timeout "$INSTALL_LIMIT_SECONDS" npm install --no-audit --no-fund --loglevel=error --min-release-age=1 "$@" || status=$?
  if [ "$status" -eq 124 ]; then
    echo "[bake] $id: $step did not finish within ${INSTALL_LIMIT_SECONDS}s" >&2
  fi
  return "$status"
}

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  install 'npm install the registry dependencies'
  install 'npm install the workspace closure tarballs' "$@"
done
