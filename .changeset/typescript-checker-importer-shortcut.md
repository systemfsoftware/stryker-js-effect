---
"@systemfsoftware/stryker-js-typescript-checker": minor
---

Adds the `typescriptChecker.importerCheck` option. With `'location-rule'` (the default), a mutant that compiles in its own file skips re-checking the files that import it when the edit sits inside the body of a function whose declared signature does not depend on that body, does not reach the body's closing brace, leaves the file free of syntax errors, and is in a TypeScript module with no `declare global`, `import()`, `require()` or import type in the edit. Such mutants from different files share one snapshot update. `'always'` re-checks importers for every mutant that compiles in its own file and checks one mutant per update, as before. An invalid value fails the checker with reason `invalid-checker-options`.
