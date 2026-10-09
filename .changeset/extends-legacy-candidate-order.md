---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A tsconfig `extends` that names a package without `exports` now picks the same base config as TypeScript 7. `<subpath>.json` comes before the config inside a `<subpath>` directory, a file named exactly `<subpath>` with no extension is never used, and inside a package directory the file its manifest names in a `tsconfig` field comes before that directory's own config. Previously the checker preferred the directory's config and ignored the `tsconfig` field, so the program digest could follow a base config the compiler doesn't load.
