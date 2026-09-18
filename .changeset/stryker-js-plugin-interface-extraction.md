---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-plugin-runtime": major
---

The plugin boundary now ships as the two packages `@systemfsoftware/stryker-js-plugin-interface` and `@systemfsoftware/stryker-js-plugin-runtime`, and everything a plugin declares as its own concept surface comes from them rather than from a package of its own.

`@systemfsoftware/stryker-js-plugin-interface` owns the contract both sides of the process split agree on: the per-kind `@effect/rpc` groups (`TestRunnerRpcs`, `CheckerRpcs`, `ReporterRpcs`), the boundary payload schemas, the typed boundary errors (`BoundaryPayloadRejected`, `BoundaryUnrecognizedSignal`), the spawn contract (`WorkerPluginKind`, `WorkerPluginSpawnSchema`, `WorkerEntryUrl`), and the trace-context contract (`TraceContextMiddleware`, `PropagatedTrace`, `TracedRpc`, `formatTraceparent`, `parseTraceparent`, `TraceContextReference`, `TRACEPARENT_HEADER`, `TRACESTATE_HEADER`).

`@systemfsoftware/stryker-js-plugin-runtime` owns what a plugin process actually runs: the worker server layer a plugin's `main.ts` launches (`workerServerLayer`, `nodeModuleLayer`), the worker and host OTel bootstraps (`startWorkerTelemetry`, `startHostTelemetry`), the worker-options wire codec (`encodeWorkerOptions`, `decodeWorkerOptions`, `readWorkerOptionsFromEnv`), and the trace-context middleware implementations (`layerTraceContextClient`, `layerTraceContextServer`, `withLinkedSpan`, `tracePartsOf`).

To migrate, install `@systemfsoftware/stryker-js-plugin-interface` and import the contract symbols listed above from it, and install `@systemfsoftware/stryker-js-plugin-runtime` for the worker-side symbols; import the run engine, the configuration surface and the option type from `@systemfsoftware/stryker-js`. The former in-process surface (`declarePlugin`, `composePlugins`, `PluginContribution`, `PluginLayerContribution`, `PluginKind`, `PluginEnvironment`, `RunConfiguration`, `SandboxDirectory`) no longer exists: a plugin now declares `strykerPlugins: readonly { kind, name }[]` and a worker entry exported under `./worker` (or a `bin`) that serves the per-kind `RpcServer`.
