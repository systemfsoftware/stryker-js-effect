---
"@systemfsoftware/stryker-js": patch
---

`cleanTempDir` now decides from how the run ended. With the default (`true`), a successful run removes its `.stryker-tmp/sandbox-*` directory and a failed run keeps it; previously every sandbox was kept, so `.stryker-tmp` grew with each run. `cleanTempDir: false` now keeps the sandbox after every run instead of deleting it. `'always'` still removes it after every run.
