---
"@systemfsoftware/stryker-js-cli-contract": major
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js-typescript-checker": major
"@systemfsoftware/stryker-js-plugin-runtime": major
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-html-reporter": major
---

`effect` is a peer dependency (`^4.1.2`) of every package whose library entry points import it, so a consumer's schemas, layers and errors and these packages' share one effect instance.

- cli-contract, plugin-interface, instrumenter, typescript-checker and plugin-runtime declared `effect` as a dependency. A consumer on another 4.1.x got a second copy, and the contract's `ShardPlan` no longer type-checked against the consumer's effect. They now peer on it; install `effect` yourself.
- stryker-js and the html-reporter already peered on `effect`; the floor rises from 4.1.0 to 4.1.2, the version these packages are built and tested with.

The processes Stryker starts are unchanged: the CLI (`main.mjs`), the TypeScript checker's worker and the vitest runner's worker bundle their own effect 4.1.2. The flake package `stryker-package` now declares `effect` itself.
