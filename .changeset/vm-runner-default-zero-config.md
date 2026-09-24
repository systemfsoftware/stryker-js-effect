---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

The in-process `vm` runner is now the default `testRunner`. With no `testRunner` and no `testFiles` configured, the vm runner asks Vitest which files are tests. It runs exactly the files `vitest run` would, including your config's `include`, `exclude`, and `includeSource`, or Vitest's defaults when there is no config file. A run that loads no test files, or whose initial run registers zero tests, now fails the dry run with an error naming the `vm` runner and pointing at `testFiles`, instead of reporting a successful run where every mutant survives. Projects that relied on the previous default shelling out to a test command must set `testRunner: 'command'` (or `'vitest'`) to keep that behaviour.
