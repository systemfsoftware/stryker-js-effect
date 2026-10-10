#!/bin/sh
set -eu

before="$1"
shift
deadline_seconds=300
kill_after_seconds=10

install() {
  id="$1"
  what="$2"
  shift 2
  echo "[bake] $id: npm install $what" >&2
  started="$(date +%s)"
  if timeout -s TERM -k "$kill_after_seconds" "$deadline_seconds" npm install --no-audit --no-fund --loglevel=error --min-release-age=1 "$before" "$@"; then
    return 0
  else
    code=$?
  fi
  if [ $(($(date +%s) - started)) -ge "$deadline_seconds" ]; then
    echo "E2E_BAKE_STALLED: $id: npm made no progress installing $what for ${deadline_seconds}s." >&2
    echo "Next: resolve the staged $id manifest on the host with npm install --package-lock-only $before; the release it cannot settle is the one to pin. Re-running stalls the same way." >&2
  fi
  exit "$code"
}

for dir in /baked/*/; do
  id="$(basename "$dir")"
  cd "$dir"
  install "$id" 'the registry dependencies'
  install "$id" 'the workspace closure tarballs' "$@"
done
