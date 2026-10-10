---
title: The checker's equivalence emit left .js beside project sources, so later runs selected different tests
date: 2026-10-10
category: performance-issues
module: stryker-js-typescript-checker
problem_type: logic_error
component: tooling
symptoms:
  - "Identical bench runs of the enterprise fixture executed 481 tests on side A's first run, 472 on side B's, and 47-62 on every later run"
  - "The bench workload digest read `changed` for a project nobody edited, so the project never produced a speed signal"
  - "After a run, the project holds a `.js` next to every `.ts` source its tsconfig reaches through a `paths` alias"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [typescript-checker, tce, tsc-emit, rootdir, tsconfig-paths, vitest-related, test-selection, bench-lane]
---

# The checker's equivalence emit left .js beside project sources, so later runs selected different tests

## Problem

The TypeScript checker's equivalence check (TCE, `emitNormalized`) compiles mutated copies of a file in a temp directory with a tsconfig that `extends` the project's own. Every run also wrote compiled `.js` files into the project under check. From the second run on, Stryker resolved those stale files and selected a different, much smaller set of tests. A user whose tsconfig has `paths` aliases got a polluted source tree. In CI, the bench lane could never measure the enterprise fixture.

## Symptoms

- Bench run 38034674269 (enterprise fixture, eight runs) executed 481 tests on A0 and 472 on B1, then 47-62 on every later run. Each side's first run was the only full one.
- The incremental reports of diagnostic run 38038264758, which uploaded each run's report, differed in dry-run coverage. A0 had 14 covering test files and 118 test-file modules. A3 had 4 and 23. A3's `dryRunCoverage.testFileModules` listed `gates.js`, `stats.js` and others where A0 listed the `.ts` sources.
- The workload digest covers the test files that cover the mutants, so it differed from run to run. The report marked the project `workload changed`, which forces every cell to `no-signal`.

## Failure mechanism

1. The temp tsconfig `extends` the project's tsconfig, which inherits its `paths` aliases and package resolution. Imports in the mutated file pull real project sources into the temp program.
2. `tsc` writes the output of an input outside `rootDir` next to that input. The pulled-in sources lie outside the temp directory, so their `.js` lands in the project.
3. The next run's module resolution finds the `.js` sibling. Vitest's related-file walk follows a module graph that now ends at stale compiled files, and returns fewer covering test files.
4. Membership of the covering set therefore depends on how many runs have touched the tree:

$$\text{tests}(run_k) = f(\text{source}, \text{leftovers}(run_1 \dots run_{k-1}))$$

whereas the bench (and any user) assumes $\text{tests}(run_k) = f(\text{source})$.

## What didn't work

- **Suspecting the digest.** The digest read exactly what the runs did. Making it ignore covering test files would have hidden a real workload difference (ruled out by the supervisor).
- **Suspecting Vitest nondeterminism.** In a manual check, `vitest related` over the fixture sources, run three times on a clean scratch copy, returned 16 files and 118 tests every time. The walk is stable on a clean tree.
- **Suspecting Vitest's results cache** (`node_modules/.vite`). `BaseSequencer.sort` reorders files by cached duration and failure state. That changes order, not membership. It was not the cause.

The cause appeared only after diffing `testFileModules` between a first and a later run, then reproducing the TCE `tsc -p` call by hand in a scratch copy.

## Solution

`everyEmitUnderOutDir` makes the filesystem root the `rootDir` and puts `outDir` inside the temp directory. Every emit, pulled-in sources included, lands under the temp directory, mirrored by its absolute path. It is removed with that directory:

```ts
const everyEmitUnderOutDir = (path: Path.Path, directory: string): EmitLayout => {
  const outDir = path.join(directory, 'out')
  const filesystemRoot = path.parse(directory).root
  return { outDir, filesystemRoot, inputsOutDir: path.join(outDir, path.relative(filesystemRoot, directory)) }
}
```

`compilerOptionsOf(layout.outDir, layout.filesystemRoot)` applies the layout. Mutant emits are read back from `inputsOutDir`.

Regression scenario: "Deciding equivalence never writes JavaScript into the project it checks", in the checker's `check-mutants` integration suite. It checks a project that imports through a tsconfig `paths` alias and asserts the TCE statuses are unchanged and the project holds only the files it started with. Before the fix it failed because the checker had written a `shared.js` beside the aliased module in the scenario's temp project.

The bench orchestrator also takes `snapshotTree` of each side's project after setup (everything outside `node_modules` and `.git`) and calls `restoreTree` before every run. That removes added files, rewrites changed ones and deletes `node_modules/.vite`. Side A builds main's checker from the merge-base, and that build still leaks until this fix lands on main.

## Why this works

Invariant: **a plugin that runs a compiler over a project emits only into a directory it owns.** With `rootDir` at the filesystem root, no input is outside `rootDir`, so `tsc` never falls back to writing next to a source. Evidence: bench run 38041972492 on PR #274 reported the enterprise fixture as workload `same` with per-phase verdicts. Head executed 139 tests on every run and base executed 135-139.

## Prevention

- **Assert the tree, not only the output.** A test for any compiler-running plugin compares the project's file set before and after the plugin runs, as the regression scenario does. Checking only the files you asked for misses side effects.
- **Code smell:** a temp tsconfig that `extends` a project tsconfig and sets `outDir` without `rootDir`.
- **Diagnosis order:** when repeated runs of one configuration disagree on executed tests, diff `dryRunCoverage.testFileModules` between the first run and a later run before suspecting the runner. A `.js` where a `.ts` belongs means something wrote into the tree.
- **Repeated-run harnesses** (bench, e2e, differential checks) start every run from a restored tree. One run's leftovers (reports, sandboxes, compiled output, Vitest's cache) are inputs to the next.

## Related

- `docs/solutions/performance-issues/checker-digest-lost-to-tsconfig-extends-through-package-exports.md` covers the same temp-program machinery: how the checker resolves the extended tsconfig, where this doc covers where its emit lands.
- `docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md` states the "a run never feeds its own inputs" invariant. This doc is a case where the checker broke it.
