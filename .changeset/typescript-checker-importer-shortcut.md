---
"@systemfsoftware/stryker-js-typescript-checker": minor
---

Adds the `typescriptChecker.importerCheck` option. With `'location-rule'` (the default), a mutant that compiles in its own file skips re-checking the files that import it when the edit sits inside the body of a function whose declared signature does not depend on that body, in a TypeScript module with no `declare global`, `import()`, `require()` or import type in the edit, and no other project compiles the file except through `references` (the README lists every condition). Such mutants from different files share one snapshot update. `'always'` re-checks importers for every mutant that compiles in its own file and checks one mutant per update, as before. An invalid value, or any other key in the `typescriptChecker` block, fails the checker with `InvalidCheckerOptions` (code `invalid-checker-options`), whose message names the accepted values.
