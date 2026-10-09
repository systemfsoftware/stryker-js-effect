---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A tsconfig `extends` that names a package without `exports` now resolves the way TypeScript 7 does: `<subpath>.json` is the base before `<subpath>/tsconfig.json`, and a file named exactly `<subpath>` with no extension is never used. Previously the checker preferred the config inside the `<subpath>` directory, so when a package shipped both, the program digest followed a base config the compiler doesn't load.
