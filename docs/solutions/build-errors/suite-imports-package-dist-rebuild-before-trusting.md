---
title: Package suites imported their own dist before the source condition — and the narrow-spread case that still does
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
resolution_type: config_change
tags: [vitest, dist, workspace-imports, stale-build, test-fidelity, export-conditions, source-condition]
---

# Package suites imported their own dist before the source condition

## Problem

During the ignorer-kit migration on branch `better-ignorer`, the
`effect-schema-declarations` suite was green three times while its new visitor
implementation carried a real parity bug (computed-key annotation values were
ignored; the pin suite caught it only later under the turbo gate). The suite,
the source, and the bug were all present in every one of those runs.

## Root cause (as observed, before the dev condition existed)

Each ignorer package's test file imported the package **by name**
(`@systemfsoftware/stryker-ignorer-effect-schema-declarations`), which the
workspace resolved through the package's `exports` map to the built dist entry
point — not to the package source. Vitest does not typecheck and does not
rebuild, so the suite exercised whatever build output happened to hold:

```json
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.mjs" } }
```

```ts
import { strykerIgnorers } from '@systemfsoftware/stryker-ignorer-effect-schema-declarations'
```

`typecheck` graded `src`; `test` graded `dist`; a rebuild between two runs made
the two gates disagree.

## Superseded mechanism

The workspace now wires the `@systemfsoftware/source` dev condition, and the
shared test config supplies it to the runner in both `resolve.conditions` and
`ssr.resolve.conditions`. Vitest therefore resolves a sibling package — and a
package's own name — from `src`, provided the consuming config spreads the
shared config object **whole**. Suite fidelity no longer depends on build
freshness, so this document's failure mode (a green suite grading a stale dist)
cannot recur while that wiring is in place. Measured on the engine after the
condition reached its runner config: with the built output deleted, the suite
passed at 6 files and 18 tests with every coverage key under `src/`.

What survives is the inverse case, and it is a wiring defect rather than a
staleness one: a config that spreads only the shared config's `test` member
drops the resolver keys, and resolution falls back to `dist` again — the
symptom returns as "the suite cannot load without a build".
`docs/solutions/build-errors/vitest-config-narrow-spread-drops-source-condition.md`
owns that case.

## Solution (current)

Let the suite prove resolution by absence — delete the package's built output,
then run its suite; it must pass, with coverage keys under `src/`:

```bash
rm -rf <pkg>/dist && pnpm --filter <pkg> test
```

A failure here is a consumer-configuration defect: fix the spread, and do not
reach for a rebuild. The manual rebuild-before-trust discipline this document
originally prescribed is obsolete where the condition is wired — the earlier
advice to rebuild between runs of a parity comparison likewise, because both
comparisons now read the same `src` tree.

## Prevention

- Prove resolution, not staleness: `rm -rf <pkg>/dist` and run the suite. A
  suite that needs its package's build has a missing condition.
- Read coverage keys (`src/` versus `dist/`) as the record of which tree the
  runner actually loaded.
- Keep the turbo gate (`pnpm check:ci`) as the final word, but confirm a
  resolver change uncached (`turbo lint typecheck test --force`): a cache hit
  replays the resolution under test.

## Related

- `docs/solutions/build-errors/vitest-config-narrow-spread-drops-source-condition.md`
- `docs/solutions/tooling-decisions/workspace-source-condition-dev-resolution.md`
