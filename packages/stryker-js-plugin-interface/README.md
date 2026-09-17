# @systemfsoftware/stryker-js-plugin-interface

The mutation-testing plugin **contract**. A worker plugin — a test runner,
checker, or reporter — ships a spawn entrypoint whose target hosts an `RpcServer`
for its kind's `@effect/rpc` group; the host resolves that entrypoint from the
project's config, spawns it, and drives it over NDJSON. Every payload crossing
the boundary is a schema this package owns, and every failure is a typed variant.
The concept modules a plugin implements live in
`@systemfsoftware/stryker-js-language`.

The boundary ships as two packages:

- **`@systemfsoftware/stryker-js-plugin-interface`** (this one) — what both sides
  of the process split must agree on: the RPC groups, their payload and error
  schemas, the spawn contract, and the trace-context contract.
- **[`@systemfsoftware/stryker-js-plugin-runtime`](../stryker-js-plugin-runtime/README.md)**
  — the worker-side implementation a plugin process runs: the RPC server layer,
  its Node module port, its OTel bootstrap, the worker-options wire codec, and the
  trace-context middleware implementations.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-plugin-interface
```

A plugin process also installs the runtime package:

```sh
pnpm add @systemfsoftware/stryker-js-plugin-runtime
```

## Entry point

The interface package publishes the per-kind RPC groups (`TestRunnerRpcs`,
`CheckerRpcs`, `ReporterRpcs`), the boundary payload schemas
(`TestRunnerDryRunRequest`, `CheckerRequest`, `ReporterEventBatch`,
`ReporterInitOptions`, …), the typed error taxonomy (`BoundaryPayloadRejected`,
`BoundaryUnrecognizedSignal`), the spawn contract (`WorkerPluginKind`,
`WorkerPluginSpawn`, `WorkerPluginSpawnSchema`, `WorkerEntryUrl`), and the
trace-context contract the groups carry (`TraceContextMiddleware`,
`PropagatedTrace`, `TracedRpc`, `TraceContextReference`, `TraceContextParts`,
`formatTraceparent`, `parseTraceparent`, `Traceparent`, `TRACEPARENT_HEADER`,
`TRACESTATE_HEADER`):

```ts
import { ReporterRpcs, TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
```

The runtime package publishes the worker server layer a plugin's `main.ts`
launches (`workerServerLayer`, `WorkerServerParams`), the Node module port
(`nodeModuleLayer`), the worker's OTel exporter layer
(`workerTelemetryLayer`, merged inside `workerServerLayer`), the worker-options
wire codec (`encodeWorkerOptions`, `decodeWorkerOptions`,
`readWorkerOptionsFromEnv`), and the trace-context implementations
(`layerTraceContextClient`, `layerTraceContextServer`, `withLinkedSpan`,
`tracePartsOf`, `partsOfEffectSpan`):

```ts
import { layerTraceContextServer, workerServerLayer } from '@systemfsoftware/stryker-js-plugin-runtime'
```

Telemetry is a layer everywhere: the worker's exporter is merged inside
`workerServerLayer`, and a host provides its own `NodeSdk.layer`-based layer at
its composition root. Both are no-ops unless `OTEL_ENABLED` is `true`.

## The entry a plugin ships

A worker plugin ships one process entrypoint, `src/main.ts`. That file launches
`workerServerLayer(...)` through its platform's `runMain` — the single place the
worker program is interpreted, the same shape the `stryker` CLI's own `main.ts`
takes — and the package declares the built artifact at the `./worker` subpath of
its exports map, which is where the host resolves a worker entry from.

```ts
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { workerServerLayer } from '@systemfsoftware/stryker-js-plugin-runtime'

NodeRuntime.runMain(
  Layer.launch(
    workerServerLayer({ rpcs: TestRunnerRpcs, handlers: testRunnerHandlers, schemaServices: Layer.empty }),
  ).pipe(Effect.provideService(Logger.LogToStderr, true)),
)
```

## Trust boundary

The host executes a plugin's _library_ module in its own process to read the
plugin's descriptor, its ignorers, and its validation-schema contribution: that
module is trusted code, the same as any other dependency the project installs.
Only the plugin's _runtime work_ crosses into its own process — the RPC groups in
this package are what the host drives there, and a worker that crashes, runs out
of memory, or never boots is reported as a typed boundary error instead of
taking the run down.

A spawned worker inherits the host's environment and reads the run's options from
`options.json` in the worker directory the host creates, so a plugin sees the
same options and environment a local `stryker` run has. Test-runner and checker
workers are started in the run's sandbox directory; a reporter worker is started
in the project root it reports on.

The worker channel is a unix socket the host restricts to its owner on POSIX. On
Windows it is a named pipe: the pipe's name embeds a random UUID, and its default
security descriptor (creator owner, LocalSystem, administrators, read for
Everyone) is not tightened, because `node:net` exposes no API for it. That
residual is recorded, not closed.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-plugin-interface#readme).
