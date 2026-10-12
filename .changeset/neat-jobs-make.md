---
"@systemfsoftware/stryker-js-typescript-checker": major
---

Breaking: `CheckerRuntime.layer(options)` from the `./runtime` entry is removed. Build the same Layer with `TypeScriptCheckerRuntime.layer(options)`, exported from `./runtime` next to `CheckerRuntime`; it provides `CheckerRuntime` and `TypeScriptCompiler` with the same requirements as before. `TypeScriptCheckerRuntime.make(compiler)` builds the checker service on its own.
