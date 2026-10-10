#!/bin/sh
set -eu

argv_error() {
  echo "E2E_BAKE_ARGV: bake-fixtures.sh $1. Next: call it as bake-fixtures.sh --root=<baked dir> --deadline=<seconds> --lanes=<count>, as the harness's bakeMissing does." >&2
  exit 2
}

option() {
  case "${2-}" in
    "--$1="?*) printf '%s' "${2#--"$1"=}" ;;
    *) argv_error "got '${2-}' where --$1=<value> belongs" ;;
  esac
}

root="$(option root "${1-}")"
deadline="$(option deadline "${2-}")"
lanes="$(option lanes "${3-}")"
[ "$#" -eq 3 ] || argv_error "got $# arguments where exactly --root, --deadline and --lanes belong"
case "$deadline$lanes" in
  *[!0-9]*) argv_error "got a non-numeric --deadline=$deadline or --lanes=$lanes" ;;
esac

logs="$(mktemp -d)"
: >"$logs/reasons"

reason() {
  echo "$1: $2 Next: $3" >>"$logs/reasons"
}

relock="pnpm --filter @systemfsoftware/stryker-e2e-core fixtures:lock"

install() {
  id="$1"
  log="$logs/$id.log"
  echo "[bake] $id: npm ci" >&2
  started="$(date +%s)"
  if timeout -s TERM -k 10 "$deadline" npm ci --no-audit --no-fund --loglevel=error >"$log" 2>&1; then
    echo "[bake] $id: installed in $(($(date +%s) - started))s" >&2
    return 0
  else
    code=$?
  fi
  elapsed=$(($(date +%s) - started))
  grep -v '^npm notice' "$log" | tail -n 20 >&2
  tarball="$(sed -n 's/^npm error path \(.*\.tgz\)$/\1/p' "$log" | head -n 1)"
  first="$(sed -n 's/^npm error //p' "$log" | head -n 1 | cut -c1-200)"
  mismatch="$(grep -E '^npm error (Missing|Invalid): ' "$log" | head -n 3 | sed 's/^npm error //' | tr '\n' ' ' | cut -c1-400)"
  if [ "$code" -eq 124 ] || [ "$elapsed" -ge "$deadline" ]; then
    reason E2E_BAKE_STALLED "$id: npm ci did not finish within ${deadline}s (exit $code after ${elapsed}s)." "if the registry was slow, re-run the job; if it stalls again, run npm ci in test/e2e/testResources/$id on the host to find the request that hangs."
  elif [ -n "$tarball" ]; then
    reason E2E_BAKE_TARBALL_MISSING "$id: npm ci found no closure tarball $(basename "$tarball") at $tarball." "the lock names a closure member the harness did not pack; run $relock and commit test/e2e/testResources/$id/package-lock.json."
  else
    reason E2E_BAKE_FAILED "$id: npm ci exited $code: ${first:-no npm error line}${mismatch:+ ($mismatch)}." "run $relock, commit test/e2e/testResources/$id/package-lock.json, and if it still fails run npm ci in that fixture on the host."
  fi
  return "$code"
}

lane() {
  own="$1"
  index=0
  lane_failed=0
  for dir in "$root"/*/; do
    if [ $((index % lanes)) -eq "$own" ]; then
      cd "$dir"
      install "$(basename "$dir")" || lane_failed=1
    fi
    index=$((index + 1))
  done
  return "$lane_failed"
}

pids=''
n=0
while [ "$n" -lt "$lanes" ]; do
  lane "$n" &
  pids="$pids $!"
  n=$((n + 1))
done

failed=0
for pid in $pids; do
  wait "$pid" || failed=1
done
cat "$logs/reasons" >&2
exit "$failed"
