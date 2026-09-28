#!/bin/sh
set -eu

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  echo "[bake] $id: npm install the registry dependencies" >&2
  npm install --no-audit --no-fund --loglevel=error
  echo "[bake] $id: npm install the workspace closure tarballs" >&2
  npm install --no-audit --no-fund --loglevel=error /packs/*.tgz
  for alias in \
    node_modules/@systemfsoftware/stryker-js-vm-runner \
    node_modules/@systemfsoftware/stryker-js/node_modules/@systemfsoftware/stryker-js-vm-runner
  do
    if [ -d "$alias" ] && [ -d node_modules/@systemfsoftware/stryker-js-vitest-runner ]; then
      echo "[bake] $id: point $alias at the packed workspace runner" >&2
      rm -rf "$alias"
      cp -R node_modules/@systemfsoftware/stryker-js-vitest-runner "$alias"
    fi
  done
done
