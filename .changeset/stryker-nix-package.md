---
"@systemfsoftware/stryker-js": major
---

The CLI ships as the flake's `stryker` package (`nix run github:systemfsoftware/stryker-js-effect/<release>#stryker`): `bin/stryker` with the vitest runner, the TypeScript checker, the instrumenter, the svelte framework and both Effect ignorers in one `lib/node_modules` tree. A project installs none of them; to type its `stryker.config.ts` it links `lib/node_modules/@systemfsoftware/stryker-js` from that package.

- A bare plugin name in `plugins`, `appendPlugins`, `ignorers`, `testRunner.plugin` or a checker's `plugin` now resolves from the CLI's own install, not from the project. A plugin the CLI does not ship is named by its `file:` URL, for example `import.meta.resolve('my-ignorer')` in the config.
- The package no longer declares a `bin`. Run `stryker` from the flake's package.
