## 6.0.0

### Major Changes

- `testRunner`, `checkers`, and `ignorers` now carry the plugin and its options together.

  - `testRunner` is `'command'`, `'vm'`, or `{ plugin, options?, nodeArgs? }`.
  - `checkers` is `{ plugin, options?, nodeArgs? }[]`. Each checker is its own plugin.
  - `ignorers` is plugin file URLs. Every ignorer those modules export runs. There is no separate name list.
  - Put Vitest settings on `testRunner.options` (`configFile`, `dir`, `related`). There is no `vitest` block.
  - Put TypeScript checker settings on that checker's `options` (`prioritizePerformanceOverAccuracy`). There is no `typescriptChecker` block.

  Before:

  ```ts
  export default defineConfig({
    testRunner: 'vitest',
    checkers: ['typescript'],
    plugins: [
      import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
      import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
      import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    ],
    vitest: { configFile: 'vitest.config.ts' },
    typescriptChecker: { prioritizePerformanceOverAccuracy: true },
    ignorers: ['effect-schema-declarations'],
  })
  ```

  After:

  ```ts
  export default defineConfig({
    testRunner: {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
      options: { configFile: 'vitest.config.ts' },
    },
    checkers: [
      {
        plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
        options: { prioritizePerformanceOverAccuracy: true },
      },
    ],
    ignorers: [
      import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    ],
  })
  ```

- Plugin entries in `plugins` and `appendPlugins` are now the entrypoints
  themselves, as `file:` URLs, instead of package names Stryker resolved for you.

  Stryker resolved every specifier against its own module before, so a plugin the
  project had installed was only found when Node happened to walk to the right
  `node_modules` from Stryker's location — which is not the project's location for
  a global install, an `npx` run, or a strict isolated store. The project now
  resolves each plugin itself, in the config module where the project's own
  dependencies are visible:

  ```ts
  import { defineConfig } from '@systemfsoftware/stryker-js/config'

  export default defineConfig({
    plugins: [import.meta.resolve('@acme/stryker-runner')],
  })
  ```

  The `--plugins` and `--appendPlugins` flags take the same resolved URLs. A value
  that is not a `file:` URL is refused with the entry named.

  Stryker no longer reports an unresolved specifier as a warning it can continue
  past, because it no longer resolves one: a plugin that cannot be loaded stops
  the run and names the entry, and a plugin that loads but contributes nothing is
  still reported as before.
