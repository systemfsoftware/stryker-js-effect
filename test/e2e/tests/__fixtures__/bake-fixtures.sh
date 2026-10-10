#!/bin/sh
set -eu

INSTALL_LIMIT_SECONDS=300
KILL_AFTER_SECONDS=10

install() {
  step="$1"
  shift
  echo "[bake] $id: $step" >&2
  started="$(date +%s)"
  status=0
  timeout -k "$KILL_AFTER_SECONDS" "$INSTALL_LIMIT_SECONDS" \
    npm install --no-audit --no-fund --loglevel=error --min-release-age=1 "$@" || status=$?
  if [ "$status" -ne 0 ] && [ $(($(date +%s) - started)) -ge "$INSTALL_LIMIT_SECONDS" ]; then
    echo "[bake] $id: $step did not finish within ${INSTALL_LIMIT_SECONDS}s" >&2
  fi
  return "$status"
}

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  install 'npm install the registry dependencies'
  install 'npm install the workspace closure tarballs' --save-prod $(cat "/baked/$id.specs")
done
