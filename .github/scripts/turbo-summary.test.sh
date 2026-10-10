#!/usr/bin/env bash
set -euo pipefail

reader="$(dirname "$0")/turbo-summary.sh"
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
status=0

expect() {
  local name=$1 want_exit=$2 want_out=$3 got_exit=0 got_out
  shift 3
  got_out=$("$reader" "$@") || got_exit=$?
  if [ "$got_exit" != "$want_exit" ] || [ "$got_out" != "$want_out" ]; then
    printf '::error title=TURBO_SUMMARY_READER::%s: want exit %s and %q, got exit %s and %q\n' \
      "$name" "$want_exit" "$want_out" "$got_exit" "$got_out"
    status=1
  fi
}

cat > "$dir/ok.json" << 'EOF'
{"tasks": [
  {"taskId": "a#build", "command": "tsdown", "hash": "h1", "cache": {"status": "HIT"}, "execution": {"exitCode": 0}},
  {"taskId": "b#test", "command": "vitest", "hash": "h2", "cache": {"status": "MISS"}, "execution": {"exitCode": 1}},
  {"taskId": "d#build", "command": "tsdown", "hash": "h4", "cache": {"status": "MISS"}, "execution": null},
  {"taskId": "c#lint", "command": "<NONEXISTENT>", "hash": "h3", "cache": {"status": "MISS"}}
]}
EOF
expect 'a well-formed summary' 0 $'missed=2\nfailed=b#test' "$dir/ok.json"

jq '.tasks[1].execution |= del(.exitCode)' "$dir/ok.json" > "$dir/no-exit-code.json"
expect 'a failed task without an exit code' 2 'missing=.tasks[].execution.exitCode' "$dir/ok.json" "$dir/no-exit-code.json"

jq '.tasks[0].cache |= del(.status)' "$dir/ok.json" > "$dir/no-cache-status.json"
expect 'a task without a cache status' 2 'missing=.tasks[].cache.status' "$dir/no-cache-status.json"

expect 'no summary at all' 2 'missing=.turbo/runs/*.json (no run summary was written)'

exit "$status"
