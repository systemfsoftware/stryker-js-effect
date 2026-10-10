#!/bin/sh
set -eu

case "${1-}" in
  --before=?*) before="$1" ;;
  *)
    echo "E2E_BAKE_ARGV: bake-fixtures.sh got '${1-}' where its first argument must be --before=<registry cutoff>. Next: pass --before= with REGISTRY_CUTOFF from test/e2e-core/src/registry-pins.ts ahead of the tarball specs." >&2
    exit 2
    ;;
esac
shift

install_seconds=90
lanes=4
logs=/tmp/bake
mkdir -p "$logs"
: >"$logs/reasons"

reason() {
  echo "$1: $2 Next: $3" >>"$logs/reasons"
}

install() {
  id="$1"
  step="$2"
  what="$3"
  shift 3
  log="$logs/$id.$step.log"
  echo "[bake] $id: npm install $what" >&2
  started="$(date +%s)"
  if timeout -s TERM "$install_seconds" npm install --no-audit --no-fund --loglevel=error "$before" "$@" >"$log" 2>&1; then
    return 0
  else
    code=$?
  fi
  elapsed=$(($(date +%s) - started))
  tail -n 20 "$log" >&2
  missing="$(sed -n 's/.*No matching version found for \([^ ]*\) with a date before.*/\1/p' "$log" | head -n 1)"
  if [ "$elapsed" -ge "$install_seconds" ]; then
    reason E2E_BAKE_STALLED "$id: npm install $what did not finish within ${install_seconds}s (exit $code after ${elapsed}s)." "if the registry was slow, re-run the job; if it stalls again, resolve the staged $id manifest on the host with npm install --package-lock-only $before and pin the release npm cannot settle."
  elif [ -n "$missing" ]; then
    reason E2E_BAKE_CUTOFF_STALE "$id: npm found no $missing published before the registry cutoff ${before#--before=}." "set REGISTRY_CUTOFF in test/e2e-core/src/registry-pins.ts to the pnpm-lock.yaml commit time (git log -1 --format=%cI -- pnpm-lock.yaml)."
  fi
  exit "$code"
}

lane() {
  own="$1"
  shift
  index=0
  for dir in /baked/*/; do
    if [ $((index % lanes)) -eq "$own" ]; then
      id="$(basename "$dir")"
      cd "$dir"
      install "$id" registry 'the registry dependencies'
      install "$id" closure 'the workspace closure tarballs' "$@"
    fi
    index=$((index + 1))
  done
}

pids=''
n=0
while [ "$n" -lt "$lanes" ]; do
  lane "$n" "$@" &
  pids="$pids $!"
  n=$((n + 1))
done

failed=0
for pid in $pids; do
  wait "$pid" || failed=1
done
cat "$logs/reasons" >&2
exit "$failed"
