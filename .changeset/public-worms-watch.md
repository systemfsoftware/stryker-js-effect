---
"@systemfsoftware/stryker-js": major
---

The engine and the CLI are one package. `@systemfsoftware/stryker-js` now ships
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
