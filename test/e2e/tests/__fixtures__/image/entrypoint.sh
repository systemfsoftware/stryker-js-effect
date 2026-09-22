#!/bin/sh
set -eu

if [ "${1:-}" = "--bake-all" ]; then
  mkdir -p /baked
  for src in /fixtures-src/*; do
    id="$(basename "$src")"
    dest="/baked/$id"
    echo "[bake] $id"
    mkdir -p "$dest"
    cp -a "$src/." "$dest/"
    cd "$dest"
    npm install --no-audit --no-fund --loglevel=error
    npm install --no-audit --no-fund --loglevel=error /packs/*.tgz
  done
  exit 0
fi

fixture="${1:?usage: entrypoint.sh <fixture> <command...>}"
shift

if [ ! -f /work/.baked-complete ]; then
  cp -a "/baked/$fixture/." /work/
  touch /work/.baked-complete
fi

cd /work
exec "$@"
