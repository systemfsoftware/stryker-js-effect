---
'@systemfsoftware/stryker-vm-harness': patch
---

The vm runner no longer rewrites `import.meta.vitest` text that is not an expression. A string, template literal, comment or regex literal that mentions `import.meta.vitest` now reaches your code unchanged, so suites whose fixtures contain it, such as lint-rule tests, pass on the vm runner as they do under Vitest. In-source `if (import.meta.vitest)` tests still register and run, and `import.meta.vitest` inside a template `${…}` substitution still evaluates to the Vitest API.
