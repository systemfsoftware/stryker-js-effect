# @systemfsoftware/stryker-js-plugin-runtime

## 7.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@14.0.0

## 7.0.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.3.0
  - @systemfsoftware/stryker-js-plugin-interface@13.0.0

## 7.0.0

### Major Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.2.0
  - @systemfsoftware/stryker-js-plugin-interface@12.0.0

## 6.0.5

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@11.0.0

## 6.0.4

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

## 6.0.3

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@10.0.0

## 6.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@9.0.0

## 6.0.1

### Patch Changes

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

## 6.0.0

### Major Changes

- Each package's main entry point now groups its exports into namespaces named after a capability, such as `Plugin`, `TestRunner` and `Report`.

  - Import the namespace and qualify each name, for example `Plugin.TestRunnerRpcs` after importing `Plugin` from the plugin interface.
  - Import instrumenter schemas such as `Location` and `MutantStatus` from the instrumenter's `Mutant` namespace, and plugin-interface names from the plugin interface, instead of through another package's entry point.
  - The engine's `/config`, `/events` and `/promises` entry points are unchanged.

- `partsOfEffectSpan` and `tracePartsOf` are replaced by the `TraceContextPartsFromEffectSpan` codec, which decodes an `EffectSpanIdentity`.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@8.0.0

## 5.0.4

### Patch Changes

- Three opt-in mutators plant Effect concurrency faults on top of the default set, so a mutation run can check that your concurrency tests catch races. `AtomicUpdateSplit` splits read-modify-write calls on `Ref` and `SynchronizedRef` into a separate read, a yield, and a separate write. `SynchronizationRemoval` removes semaphore permits, `Effect.uninterruptible`, and `Effect.uninterruptibleMask`. `FinalizerEscape` stops `ensuring`, `onExit`, `onError`, `onInterrupt`, `acquireRelease`, and `acquireUseRelease` cleanup from running on interruption. All three are off by default. Enable any subset by listing them under `mutator: { optInMutations: [...] }` in your configuration. A name that is not an opt-in mutator fails the run, and the error lists the known names. The replacements use Effect 4 APIs, so a repository on Effect 3.x must not opt in.

## 5.0.3

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 5.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@7.0.0

## 5.0.1

### Patch Changes

- Unix worker sockets are now owner-read-write once the worker has bound them. Named pipes are unchanged.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@6.0.0

## 5.0.0

### Major Changes

- Every module Stryker loads — config files, `extends` targets, plugins, and the vitest runner's own vitest — now resolves and imports through Node's native ECMAScript module system: `import.meta.resolve` resolves each bare specifier from the consuming module, and dynamic `import()` loads the resolved URL. The package's `exports` map (or a legacy `main`) selects the entry file, ESM-only plugin packages load, and no require-based loader ships in any package. An unresolvable bare specifier warns with a machine-readable reason; the run fails at prepare only when nothing provides the configured runner or checker. Node.js 22.18.0 or later is required.

  To migrate, install Node.js 22.18.0 or later. Bare plugin specifiers keep working, but a plugin package must publish an ES module entry through `exports` or `main`, and the plugin must be resolvable from where Stryker itself is installed.

- `@systemfsoftware/stryker-js` is renamed to `@systemfsoftware/stryker-js-language`, and the plugin boundary now ships as the two packages `@systemfsoftware/stryker-js-plugin-interface` and `@systemfsoftware/stryker-js-plugin-runtime`.

  `@systemfsoftware/stryker-js-plugin-interface` owns the contract both sides of the process split agree on: the per-kind `@effect/rpc` groups (`TestRunnerRpcs`, `CheckerRpcs`, `ReporterRpcs`), the boundary payload schemas, the typed boundary errors (`BoundaryPayloadRejected`, `BoundaryUnrecognizedSignal`), the spawn contract (`WorkerPluginKind`, `WorkerPluginSpawnSchema`, `WorkerEntryUrl`), and the trace-context contract (`TraceContextMiddleware`, `PropagatedTrace`, `TracedRpc`, `formatTraceparent`, `parseTraceparent`, `TraceContextReference`, `TRACEPARENT_HEADER`, `TRACESTATE_HEADER`).

  `@systemfsoftware/stryker-js-plugin-runtime` owns what a plugin process actually runs: the worker server layer a plugin's `main.ts` launches (`workerServerLayer`, `nodeModuleLayer`), the worker and host OTel bootstraps (`startWorkerTelemetry`, `startHostTelemetry`), the worker-options wire codec (`encodeWorkerOptions`, `decodeWorkerOptions`, `readWorkerOptionsFromEnv`), and the trace-context middleware implementations (`layerTraceContextClient`, `layerTraceContextServer`, `withLinkedSpan`, `tracePartsOf`).

  To migrate, update the package name on every import that is not a plugin symbol to `@systemfsoftware/stryker-js-language`; install `@systemfsoftware/stryker-js-plugin-interface` and import the contract symbols listed above from it, and install `@systemfsoftware/stryker-js-plugin-runtime` for the worker-side symbols. The former in-process surface (`declarePlugin`, `composePlugins`, `PluginContribution`, `PluginLayerContribution`, `PluginKind`, `PluginEnvironment`, `RunConfiguration`, `SandboxDirectory`) no longer exists: a plugin now declares `strykerPlugins: readonly { kind, name }[]` and a worker entry exported under `./worker` (or a `bin`) that serves the per-kind `RpcServer`.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.
