---
title: Package suites import their own dist, so green can grade yesterday's build
date: 2026-09-15
category: build-errors
module: stryker-js-family
problem_type: test_failure
component: tooling
severity: high
symptoms:
  - "A test suite stays green across three runs while the source it claims to test carries a real behavior regression, then goes red only after an unrelated package rebuild"
  - "The same branch is green in a standalone `pnpm --filter <pkg> test` and red in the turbo gate minutes later, with no source change in between"
  - "Typecheck reads the new source and fails while the suite reading the same tree passes, on identical code"
root_cause: config_error
resolution_type: workflow_improvement
tags: [vitest, dist, workspace-imports, stale-build, test-fidelity, turbo, rebuild]
---

# Package suites import their own dist, so green can grade yesterday's build

## Problem

During the ignorer-kit migration on branch `better-ignorer`, the
`effect-schema-declarations` suite was green three times while its new visitor
implementation carried a real parity bug (computed-key annotation values were
ignored; the pin suite caught it only later under the turbo gate). The suite,
the source, and the bug were all present in every one of those runs.

## Root cause

Each ignorer package's test file imports the package **by name**
(`@systemfsoftware/stryker-ignorer-effect-schema-declarations`), which the
workspace resolves through the package's `exports` map to the built dist entry
point — not to the package source. Vitest does not typecheck and does not
rebuild, so the suite exercises whatever build output happens to hold:

```json
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.mjs" } }
```

```ts
import { strykerIgnorers } from '@systemfsoftware/stryker-ignorer-effect-schema-declarations'
```

`typecheck` grades `src`; `test` grades `dist`. When a rebuild happens between
two runs, the two gates disagree — which is exactly the "green standalone, red
in turbo" flip that was observed. Testing the built artifact is the _right_
posture (it grades what ships); the trap is only that nothing in the inner loop
keeps `dist` fresh.

## Solution

Rebuild the package before trusting any run of its suite:

```bash
pnpm --filter <pkg> exec tsdown && pnpm --filter <pkg> test
```

For parity work that compares an old implementation against a new one, rebuild
between the two comparison runs as well — otherwise both "implementations" may
be the same stale dist. The long-term fix is wiring `test` to depend on the
package's own build in the turbo graph; until then the rebuild is manual
discipline, recorded in the PR description's validation notes.

## Prevention

- After **any** source change in a family package, run that package's build
  (`tsdown`) before reading a green suite as evidence.
- Treat "suite green but typecheck red" (or the reverse) as a dist-staleness
  signal first, not as a paradox: the two gates read different trees.
- Prefer the turbo gate (`pnpm check:ci`) over standalone package tests as the
  final word — turbo's build tasks run ahead of tests in the graph.
