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
  echo "[bake] $id: install the flake's stryker package" >&2
  cp -R /stryker/lib node_modules/.stryker
  chmod -R u+w node_modules/.stryker
  mkdir -p node_modules/@systemfsoftware node_modules/.bin
  ln -s ../.stryker/node_modules/@systemfsoftware/stryker-js node_modules/@systemfsoftware/stryker-js
  ln -s ../.stryker/node_modules/@systemfsoftware/stryker-js/dist/main.mjs node_modules/.bin/stryker
done
