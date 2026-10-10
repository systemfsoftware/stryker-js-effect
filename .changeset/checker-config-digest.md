---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-typescript-checker": minor
---

A checker can now report a configuration digest separately from its program digest. The configuration digest covers what the checker was set up with: its versions, its options and the tsconfig chain it loads. It does not cover the source files the program contains, so a checker can answer it without building a program.

Breaking: `CheckerService.digest` is now a function of a scope, `'config'` or `'program'`, rather than a single effect, and `CheckerDigestRequest` carries that `scope`. A custom checker must return its configuration digest for `'config'` and its existing program digest for `'program'`. The TypeScript checker answers both.
