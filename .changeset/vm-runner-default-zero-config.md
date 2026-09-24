---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

The in-process `vm` runner is now the default `testRunner`. With no `testRunner` and no `testFiles` configured, the vm runner discovers test files itself next to the mutated code, using Vitest's default include (`**/*.{test,spec}.*`, including the `.cjs`/`.mjs`/`.cts`/`.mts` spellings) and skipping `node_modules`, `dist`, hidden tool directories, and the Stryker temp directory. A run that loads no test files — or whose initial run registers zero tests — now fails the dry run with an error naming the `vm` runner and pointing at `testFiles`, instead of reporting a successful run where every mutant survives. Projects that relied on the previous default shelling out to a test command must set `testRunner: 'command'` (or `'vitest'`) to keep that behaviour.
