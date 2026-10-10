---
title: The scripts Deno import map also resolves the e2e trace scripts, so pruning it breaks every e2e lane
date: 2026-10-09
category: workflow-issues
module: e2e-telemetry
problem_type: workflow_issue
component: tooling
severity: medium
applies_when:
  - "Removing or pruning entries in the scripts Deno import map or its lockfile"
  - "Deleting a repository Deno script and tidying the imports it alone used"
  - "Every CI e2e lane fails at Export telemetry while its E2E lane step passed"
---

# The scripts Deno import map also resolves the e2e trace scripts, so pruning it breaks every e2e lane

## Context

The repository's scripts `deno.json` is not private to the scripts beside it. The e2e trace script `import-traces.ts` resolves its bare `@std/*` specifiers through it: its shebang passes that `deno.json` as `--config`, as a path relative to the repository root. It imports `@std/path`. (The search-based `export-traces.ts`, which also imported `@std/fs/ensure-dir`, is gone; CI captures traces from the collector instead.)

## Problem

Deleting the local guards removed the last neighbouring importer of several `@std/*` modules. Pruning the import map down to what the remaining neighbour imports looked complete, and `deno check` over the neighbours passed. Every e2e lane then failed in its `Export telemetry` step with `Import "@std/fs/ensure-dir" not a dependency and not in import map`, while the `E2E lane` step itself passed. The step runs `if: always()` after the journeys, so the failure looks like a telemetry outage rather than an import-map edit.

## Guidance

- **Find every consumer before pruning.** An import map's consumers are every file whose run or check names it, not the files beside it. Search for the config path itself; it lists the shebangs and tasks that read it:

  ```sh
  git grep -n 'scripts/deno.json'
  ```

- **Check the pruned map against all of them.** Type-check every consumer the search found with the map, and refresh the lockfile so it stays consistent:

  ```sh
  ./bin/deno check --config=scripts/deno.json <every consumer>
  ./bin/deno install --config=scripts/deno.json --frozen=false
  ```

- **Read the failing step, not the job colour.** An e2e job whose `E2E lane` step is green and whose `Export telemetry` step is red points at the trace scripts and their resolution, not at the product or the LGTM stack.

## Why This Works

An import map is a shared resolution table whose consumers are declared at the use site (a shebang flag), not at the definition site. A rule that derives the map from the files beside it under-counts them. Deriving it from a search for the config path counts every reader, including ones in other directories that CI runs only on the e2e path.

## Prevention

- Gate: the `check` job's `Repo scripts tests` step type-checks `import-traces.ts` against the scripts `deno.json` on every pull request and fails on an unresolved import.
- Smell: a diff to the scripts `deno.json` that removes `imports` entries while a search for its path still lists a consumer outside the scripts directory.
