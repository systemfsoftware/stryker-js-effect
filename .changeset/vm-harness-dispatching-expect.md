---
"@systemfsoftware/stryker-vm-harness": minor
---

`Assertions.dispatchingExpect(real, createExpect)` wraps Vitest's global `expect` so each call uses the `expect` that `createExpect` builds for the running test. That per-test `expect` is what `expect.soft`, `expect.poll`, and `.resolves` need. The function also works data-last: `dispatchingExpect(createExpect)(real)`. `Assertions.guardedExpect(real)` behaves as before.
