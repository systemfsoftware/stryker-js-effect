---
"@systemfsoftware/stryker-js-vitest-runner": minor
---

The runner's worker resolves `vitest` from the sandbox it runs in, so a runner installed outside the project, such as the flake's `stryker` package, runs the project's own vitest. It used to resolve vitest from its own install location and failed with `ERR_MODULE_NOT_FOUND` when nothing installed vitest beside it.
