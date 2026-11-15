---
title: A test's shared scratch directory forged kills, and the drop audit failed the subsumption rule for them
date: 2026-11-15
category: test-failures
module: stryker-js-instrumenter
problem_type: test_failure
component: testing_framework
severity: high
applies_when:
  - a test writes files to a fixed path inside the package and deletes that path before or after it runs
  - `stryker audit` reports `killers-not-contained` where the dominator's only killers fail with ENOENT, ENOTEMPTY or another PlatformError
  - a mutant's statusReason in the kill matrix is a file-system error rather than an assertion
retire_when: "no test in the repo writes to a fixed shared path, or the kill matrix refuses a kill whose cause is a file-system error"
tags: [kill-matrix, drop-audit, subsumption, test-isolation, scratch-directory, flaky]
---

# A test's shared scratch directory forged kills, and the drop audit failed the subsumption rule for them

## Symptom

Main's scheduled Mutation run failed `drop-audit` on 2026-11-13 and 11-14, and again in run 43714016461 (11-15). The `complement` rule dropped a mutant whose dominator was killed by tests the dropped mutant survived:

| Dropped                     | Dominator                   | Site                              | Missing killers   |
| --------------------------- | --------------------------- | --------------------------------- | ----------------- |
| 6f6075f8 `text.length <= 0` | 33c6a193 `text.length >= 0` | `decode-directive.workflow.ts:56` | 267               |
| 97fbafbc `…length <= 0`     | fe93ab54 `…length >= 0`     | `decode-directive.workflow.ts:69` | 262, 264–266, 268 |

Every missing killer is a scenario of `tests/conditional-test-placement.integration.test.ts`. Their recorded kill reasons are not assertions. They are `PlatformError: NotFound … FileSystem.writeFile (…/.scratch/placement-behaviour/mutant/…)` and `ENOTEMPTY … rmdir …/.scratch/placement-behaviour//mutant`. Across the instrumenter's 943 matrix mutants, 21 carry such a file-system error as their kill.

## Cause

The subsumption rule is not at fault. The kills are forged.

- Every scenario began by deleting `.scratch/placement-behaviour/` and recreating it, and the file's `afterAll` deleted it again.
- The path is fixed per package directory, so any two executions of the file that overlap in one directory clobber each other: one deletes the modules the other is writing or reading, and that run fails whichever mutant is active. Which overlap happens inside a mutation sandbox is not established. Candidates are a worker thread still tearing down a bailed run, and a live scenario's rerun. The fix does not depend on which one it is.
- Modules were also written at `${shape}-${mutant}.ts` under the same path. A reused worker could therefore import one from the ESM cache, compiled from another run's instrumenter output.

Reproduced on main: three concurrent `vitest run` of the file in one package directory failed 12 of 12 runs with ENOENT, ENOTEMPTY and PlatformError.

## Fix

Each scenario takes its own directory, made with `FileSystem.makeTempDirectoryScoped` under `.scratch/placement-behaviour/`. It is removed when the scenario's scope closes. Nothing deletes the shared parent any more, and every module URL is unique to its run.

After the fix, the same three-way concurrent run failed 0 of 12, and the file passes alone.

## Prevention

A test that touches the file system owns a directory nobody else names. Make it scoped and unique, never a fixed path that the test clears. When the drop audit fails a pair, read the missing killers' `statusReason` in the kill matrix before touching the rule: a file-system error there is a forged kill.
