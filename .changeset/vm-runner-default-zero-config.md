---
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
---

The in-memory V8 VM runner is now the default `testRunner`. With no `testRunner` and no `testFiles` configured, the vm runner discovers test files itself next to the mutated code, using Vitest's default include (`**/*.{test,spec}.*` including `.cjs`/`.mjs`/`.cts`/`.mts` spellings) and skipping `node_modules`, `dist`, hidden tool directories, and the Stryker temp directory. A run that loads no test files — or whose initial run registers zero tests — now fails the dry run with an error naming the `vm` runner and pointing at `testFiles` (or the `vitest`/`command` runners), instead of reporting a successful run where every mutant survives. Projects that configure `testRunner` or `testFiles` explicitly are unaffected.
