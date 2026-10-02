---
title: A plugin that discovers from the mutation sandbox sees one text for every mutant
date: 2026-09-30
category: tooling-decisions
module: stryker-js-family
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - a Vite or Vitest plugin derives test entries or generated code by reading project source at config time
  - a review claims a mutant can make such a plugin miss a module during a mutation run
  - someone proposes pointing a sandbox-time plugin at the clean project root instead of the sandbox
tags: [mutation-switching, sandbox, vitest-plugin, schema-laws, discovery, code-review]
---

# A plugin that discovers from the mutation sandbox sees one text for every mutant

## Problem

`inSourceSchemaLaws` runs `findExportedSchemas` once in its `configResolved`
hook, keyed by module path, and appends each module's generated laws in
`transform`. In a mutation run the Vitest runner's `VitestRuntime` starts
Vitest with `root` set to the sandbox, so discovery reads the instrumented
sandbox copy. A code review raised a P1 against this: a mutant that removes or
renames a schema export would make discovery miss the module, and its laws
would silently vanish. The proposed fix was to discover from the clean project
root. An independent validator confirmed the claim from the code alone.

## Failure Mechanics

1. **The claim's precondition never occurs.** Mutants are switched at runtime:
   the sandbox holds one instrumented copy of every mutated file, and the
   runner's `MutantRun` cell selects the active mutant per test run
   (`session.provide('activeMutant', …)`). No mutant rewrites the text that a
   config-time hook reads.
2. **Exports survive instrumentation.** A mutant switch wraps the initializer
   (`export const X = stryMutAct_…(n) ? … : S.Struct(…)`) and keeps the
   declaration. A runtime flag selects a branch inside an expression. It
   cannot remove an `export`.
3. **The proposed fix breaks collection.** In the sandbox, Vite module ids are
   sandbox paths. A map built from clean-root paths never matches an id in
   `transform`, so every module loses its laws.

## Why This Works

Invariant: **a config-time source reader inside the sandbox sees the same bytes
for every mutant, so it must read the sandbox and key its results by sandbox
paths.**

```text
sandbox text  = instrument(all mutants)          -- fixed for the whole run
active mutant = runtime flag, per test run
discovery     = f(sandbox text)                  -- constant across mutants
lookup key    = transform id (sandbox path)      -- must match discovery's keys
```

An active mutant changes the value a schema binding evaluates to, never
whether the binding is exported. The laws then run against the mutated value
and fail, so the mutant is killed.

## Verification

Measured on 2026-09-30 against `packages/stryker-js`, in-source plugin:

- `stryker run --dryRunOnly` with the live sandbox `src` copied mid-run: 104 of
  289 `.ts` files carry mutant switches, 40 of them schema modules.
  `findExportedSchemas` over that copy and over the clean `src` both return 410
  (module, schema) pairs, with 0 differences either way.
- The same 2,801 non-`CompileError` mutants run under the old upstream law
  plugin and under `inSourceSchemaLaws`: 0 status flips.

Capture tip: run with `--cleanTempDir false` to keep the sandbox after the run
ends, whether it succeeded or failed; the default (`true`) removes it after a
successful run.

## Prevention

- Before accepting a finding whose precondition is "a mutant changes the source
  a config-time hook reads", require a probe that compares the hook's output
  over the instrumented sandbox with its output over clean source.
- Keep a sandbox-time plugin's lookup keys in the same path space as Vite's
  transform ids.

## Related

- `docs/plans/2026-09-30-1853-perf-in-source-schema-laws-plan.md`
- `docs/solutions/build-errors/in-source-vitest-block-breaks-source-condition-consumers.md`
