# @systemfsoftware/stryker-js-plugin-interface

The mutation-testing plugin boundary. A worker plugin — a test runner, checker,
or reporter — ships a spawn entrypoint whose target hosts an `RpcServer` for its
kind's `@effect/rpc` group; the host resolves that entrypoint from the project's
config, spawns it, and drives it over NDJSON. Every payload crossing the
boundary is a schema this package owns, and every failure is a typed variant.
The concept modules a plugin implements live in
`@systemfsoftware/stryker-js-language`.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-plugin-interface
```

## Entry point

One specifier carries the whole boundary. The package entry publishes the
per-kind RPC groups (`TestRunnerRpcs`, `CheckerRpcs`, `ReporterRpcs`, and the
`WorkerRpcGroups` map), the boundary payload schemas (`TestRunnerDryRunRequest`,
`CheckerRequest`, `ReporterEventBatch`, `ReporterInitOptions`, …), the typed
error taxonomy (`BoundaryPayloadRejected`, `BoundaryUnrecognizedSignal`,
`WorkerEntryMissing`), the spawn contract (`WorkerPluginKind`,
`WorkerPluginSpawn`, `WorkerPluginSpawnSchema`), the worker-options wire codec
(`encodeWorkerOptions`, `decodeWorkerOptions`), and the W3C trace-context
helpers (`layerTraceContextClient`, `layerTraceContextServer`, `tracePartsOf`):

```ts
import {
  layerTraceContextServer,
  ReporterRpcs,
  startWorkerTelemetry,
  TestRunnerRpcs,
} from '@systemfsoftware/stryker-js-plugin-interface'
```

The host bootstraps its own OTel SDK with `startHostTelemetry`; a worker
bootstraps its own with `startWorkerTelemetry`. Both are no-ops unless
`OTEL_ENABLED` is `true`.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-plugin-interface#readme).
