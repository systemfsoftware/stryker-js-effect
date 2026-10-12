#!/bin/sh
set -eu

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  echo "[bake] $id: npm ci" >&2
  npm ci --no-audit --no-fund --loglevel=error || {
    status=$?
    echo "[bake] $id: npm ci exited $status; if package-lock.json drifted or is missing, run pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock and commit the result" >&2
    exit "$status"
  }
done
