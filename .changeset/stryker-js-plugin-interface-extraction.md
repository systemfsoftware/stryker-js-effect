---
"@systemfsoftware/stryker-js-language": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

`@systemfsoftware/stryker-js` is renamed to `@systemfsoftware/stryker-js-language`, and the plugin boundary now ships as the separate package `@systemfsoftware/stryker-js-plugin-interface`. That package owns the per-kind `@effect/rpc` groups (`TestRunnerRpcs`, `CheckerRpcs`, `ReporterRpcs`), the boundary payload schemas, the typed boundary errors (`BoundaryPayloadRejected`, `BoundaryUnrecognizedSignal`, `WorkerEntryMissing`), the spawn contract (`WorkerPluginKind`, `WorkerPluginSpawnSchema`), the worker server layer a plugin's `main.ts` launches (`workerServerLayer`, `nodeModuleLayer`), the W3C trace-context helpers (`formatTraceparent`, `parseTraceparent`, `tracePartsOf`, `withLinkedSpan`, `layerTraceContextServer`, `layerTraceContextClient`), and the worker-options wire codec (`encodeWorkerOptions`, `decodeWorkerOptions`, `readWorkerOptionsFromEnv`).

To migrate, update the package name on every import that is not a plugin symbol to `@systemfsoftware/stryker-js-language`; install `@systemfsoftware/stryker-js-plugin-interface` and import the boundary symbols listed above from it instead. The former in-process surface (`declarePlugin`, `composePlugins`, `PluginContribution`, `PluginLayerContribution`, `PluginKind`, `PluginEnvironment`, `RunConfiguration`, `SandboxDirectory`) no longer exists: a plugin now declares `strykerPlugins: readonly { kind, name }[]` and a worker entry exported under `./worker` (or a `bin`) that serves the per-kind `RpcServer`.
