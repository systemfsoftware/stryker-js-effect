---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
---

Only the package manifest changes: the development dependencies on stryker-js, its runner, its checker and the two ignorers now name the released tarballs instead of the npm `latest` tag. Runtime code, dependencies and peer dependencies are unchanged.
