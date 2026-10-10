---
title: Turbo's strict env mode hides GITHUB_STEP_SUMMARY from a task
date: 2026-10-10
category: tooling-decisions
module: stryker-e2e
problem_type: workflow_issue
component: tooling
severity: medium
applies_when:
  - "a test or script run through `turbo run` writes to the GitHub job summary or reads any other runner-provided variable"
  - "a task's output that should appear in CI is present in the log but missing from the step summary"
tags: [turbo, env-mode, github-actions, step-summary, e2e]
---

# Turbo's strict env mode hides GITHUB_STEP_SUMMARY from a task

## Context

The verdict-store reuse e2e publishes the second run's reuse count (`reused/total`, floor, refusals) through the e2e fixture `publishToJobSummary`. That helper logs the block, then appends it to the file named by `GITHUB_STEP_SUMMARY` when the variable is set, and skips the append when it is not. In CI the block reached the job log but never reached the step summary, and nothing failed.

Turbo runs `test:e2e` in strict env mode (`envMode: "strict"` in `turbo run --dry=json`). A task sees only the variables named in its `env` or `passThroughEnv`, or in `globalPassThroughEnv`. `GITHUB_STEP_SUMMARY` was in none of them, so the runner set it, turbo removed it, and `Config.option` read `None`. A missing optional variable reads exactly like a local run, so the skip looked correct.

## Guidance

Name every runner-provided variable a turbo task reads in that task's `passThroughEnv` (or `env`, when the value should key the cache). For `test:e2e` in `turbo.json`:

```json
"test:e2e": {
  "cache": false,
  "passThroughEnv": ["CI", "GITHUB_STEP_SUMMARY", "OTEL_ENABLED", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME"]
}
```

Check with the variable actually set, because the dry run lists only variables present in the calling environment:

```sh
GITHUB_STEP_SUMMARY=/tmp/sum pnpm exec turbo run test:e2e --filter=@systemfsoftware/stryker-e2e --dry=json \
  | jq -c '.tasks[] | select(.taskId=="@systemfsoftware/stryker-e2e#test:e2e") | .environmentVariables.passthrough | map(split("=")[0])'
```

Before the fix this printed `["CI"]`; after it, `["CI","GITHUB_STEP_SUMMARY"]`. Without the variable set, both versions print the same thing, so that check proves nothing.

## When this applies

Any optional runner variable a turbo task reads (`GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT`, `RUNNER_TEMP`, `GITHUB_SHA`), where the code treats an absent value as "not in CI". When that absence is silent, the turbo env list is the first place to look.
