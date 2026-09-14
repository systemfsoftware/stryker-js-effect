---
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": minor
---

first release: the in-source-test-guard ignorer as a self-contained package with no peer dependencies — mutants inside an `if (import.meta.vitest)` block are unreachable in a mutation run, so the guard's contents leave the population; migrate by replacing `"@systemfsoftware/stryker-plugins"` with `"@systemfsoftware/stryker-ignorer-in-source-vitest-block"` in `plugins:` together with `ignorers: ["in-source-vitest-block"]` on `@systemfsoftware/stryker-js-engine` 4.1.0 or later
