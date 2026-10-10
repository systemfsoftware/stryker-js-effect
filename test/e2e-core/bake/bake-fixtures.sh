#!/bin/sh
set -eu

argv_error() {
  echo "E2E_BAKE_ARGV: bake-fixtures.sh $1. Next: call it as bake-fixtures.sh --before=<REGISTRY_CUTOFF> --root=<baked dir> --deadline=<seconds> --lanes=<count> <tarball specs>, as the harness's bakeMissing does." >&2
  exit 2
}

option() {
  case "${2-}" in
    "--$1="?*) printf '%s' "${2#--"$1"=}" ;;
    *) argv_error "got '${2-}' where --$1=<value> belongs" ;;
  esac
}

before="$(option before "${1-}")"
root="$(option root "${2-}")"
deadline="$(option deadline "${3-}")"
lanes="$(option lanes "${4-}")"
shift 4 2>/dev/null || true
case "$deadline$lanes" in
  *[!0-9]*) argv_error "got a non-numeric --deadline=$deadline or --lanes=$lanes" ;;
esac

logs="$(mktemp -d)"
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
  if timeout -s TERM -k 10 "$deadline" npm install --no-audit --no-fund --loglevel=error "--before=$before" "$@" >"$log" 2>&1; then
    return 0
  else
    code=$?
  fi
  elapsed=$(($(date +%s) - started))
  tail -n 10 "$log" >&2
  missing="$(sed -n -e 's/.*No matching version found for \([^ ]*\) with a date before.*/\1/p' -e 's/.*No versions available for \([^ ]*\).*/\1/p' "$log" | head -n 1)"
  if [ "$elapsed" -ge "$deadline" ]; then
    reason E2E_BAKE_STALLED "$id: npm install $what did not finish within ${deadline}s (exit $code after ${elapsed}s)." "if the registry was slow, re-run the job; if it stalls again, resolve the staged $id manifest on the host with npm install --package-lock-only --before=$before and pin the release npm cannot settle."
  elif [ -n "$missing" ]; then
    reason E2E_BAKE_CUTOFF_STALE "$id: npm found no $missing published before the registry cutoff $before." "set REGISTRY_CUTOFF in test/e2e-core/src/registry-pins.ts to the pnpm-lock.yaml commit time (git log -1 --format=%cI -- pnpm-lock.yaml)."
  fi
  exit "$code"
}

lane() {
  own="$1"
  shift
  index=0
  for dir in "$root"/*/; do
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
