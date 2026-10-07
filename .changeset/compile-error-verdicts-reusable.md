---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-cli-contract": minor
---

An incremental run now reuses `CompileError` verdicts instead of type-checking
every one again. A verdict is kept only while nothing that fed the check
changed: the mutant and its replacement, every file the checker's TypeScript
program loaded (including transitive and bundled declaration files), its
tsconfig files, the TypeScript version, the checker version and its options.
Otherwise the mutant is re-checked. The reuse stream line reports such refusals
as `programChanged`; lines without that count still decode.

Breaking: a configured checker must answer the new `digest` RPC, so upgrade
checker plugins together with this release.
