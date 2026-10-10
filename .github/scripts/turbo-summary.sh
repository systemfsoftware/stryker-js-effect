#!/usr/bin/env bash
set -euo pipefail

if (($# == 0)); then
  echo 'missing=.turbo/runs/*.json (no run summary was written)'
  exit 2
fi

missing=$(jq -rs '
  [ .[]
    | if (.tasks | type) != "array" then ".tasks"
      else .tasks[]
        | if (.command | type) != "string" then ".tasks[].command"
          elif .command == "<NONEXISTENT>" then empty
          elif (.taskId | type) != "string" then ".tasks[].taskId"
          elif (.hash | type) != "string" then ".tasks[].hash"
          elif (.cache.status | type) != "string" then ".tasks[].cache.status"
          elif (has("execution") | not) then ".tasks[].execution"
          elif .execution != null and (.execution.exitCode | type) != "number" then ".tasks[].execution.exitCode"
          else empty end
      end ]
  | first // ""
' "$@")
if [ -n "$missing" ]; then
  echo "missing=$missing"
  exit 2
fi

jq -rs '
  [.[].tasks[] | select(.command != "<NONEXISTENT>")] as $tasks
  | "missed=\([$tasks[] | select(.cache.status != "HIT")] | length)",
    "failed=\([$tasks[] | select(.execution != null and .execution.exitCode != 0) | .taskId] | unique | join(" "))"
' "$@"
