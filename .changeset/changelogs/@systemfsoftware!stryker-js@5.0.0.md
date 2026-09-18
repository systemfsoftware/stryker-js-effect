## 5.0.0

### Major Changes

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

- The engine and the CLI are one package. `@systemfsoftware/stryker-js` now ships
  the `stryker` binary, the run engine, and the configuration surface, replacing
  `@systemfsoftware/stryker-js-cli` and `@systemfsoftware/stryker-js-engine`, which
  are discontinued.

  Two subpaths are new:

  - `./config` — `defineConfig`, `mergeConfig`, `ConfigEnv`, `StrykerConfig`. Use it
    instead of hand-typing `stryker.config.ts` against the option type.
  - `./promises` — `run`, the same run interpreted for promise callers, so an
    embedding script does not need an Effect runtime.

  Migrate by importing from `@systemfsoftware/stryker-js`. Everything the two
  discontinued packages exported — the option type, `readConfig`, the plugin
  loader, `WorkerLauncher`, and the exit classification — keeps its name and its
  behavior at the new address.

  `@systemfsoftware/stryker-js-language` is gone; it is replaced rather than
  continued. The run-event vocabulary it was carrying — `RunEvents`, `RunIdentity`,
  `RunPhase`, and the `Run*` event schemas — now ships from
  `@systemfsoftware/stryker-js`. Two consequences follow for anyone who imported
  it:

  - The mutant model, the report schemas, and the checker, evaluator and
    test-runner contracts come from `@systemfsoftware/stryker-js-instrumenter`
    and `@systemfsoftware/stryker-js-plugin-interface`. Update those imports.
  - The service identifiers `@systemfsoftware/stryker-js-language/RunEvents` and
    `@systemfsoftware/stryker-js-language/RunIdentity` are now
    `@systemfsoftware/stryker-js/RunEvents` and
    `@systemfsoftware/stryker-js/RunEvents/RunIdentity`. A program that provides or
    looks up either service by its identifier string must use the new one.

  Two more changes reach programmatic callers:

  - `testRunner: 'vm'` runs the test suite in memory. Stryker strips TypeScript from
    the test files during preparation and evaluates them in a fresh V8 context per
    mutant, so a run needs no child process and no manual bundling.
  - `readConfig` and `resolveExtends` take the invocation a configuration is being
    read for, so a `stryker.config.ts` may export a factory receiving
    `{ command, isDryRun, mode, isCi }` and compute its settings per invocation.
    Both keep working for a plain exported object; the extra argument is the
    `command` and output `mode` the loader cannot see for itself.
