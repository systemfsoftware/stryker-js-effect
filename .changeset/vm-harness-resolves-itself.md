---
'@systemfsoftware/stryker-vm-harness': patch
---

Projects that install `@systemfsoftware/stryker-js` and `vitest`, but not the vm runner package directly, now complete a `testRunner: 'vm'` dry run under pnpm's default isolated `node_modules` layout, instead of failing with a `Cannot find module` error for the vm runner's own package. The project's own `vitest` is still the one that runs your tests.
