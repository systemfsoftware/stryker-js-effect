---
"@systemfsoftware/stryker-js": patch
---

The `--ignorePatterns` help now lists the patterns Stryker actually always ignores: `node_modules`, `.git`, `*.tsbuildinfo`, `/stryker.log`, `.next`, `.nuxt`, `.svelte-kit` and `.turbo`. It also names Stryker's own output files, which are always excluded: the files at `tempDirName`, `incrementalFile`, `progressStreamFile`, `htmlReporter.fileName` and `jsonReporter.fileName`, the SARIF report and the reproducers file. The old help said `/reports` was always ignored, but it never was: other files under `reports/`, such as coverage output, are part of your project. If you set `ignorePatterns: []` relying on the old help, add a pattern for any other `reports/` content you want left out.
