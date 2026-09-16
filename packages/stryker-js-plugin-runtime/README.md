# @systemfsoftware/stryker-js-plugin-runtime

The mutation-testing plugin **runtime** — the worker-side implementation of the
boundary described by
[`@systemfsoftware/stryker-js-plugin-interface`](../stryker-js-plugin-interface/README.md).
A plugin's `main.ts` launches this package's `workerServerLayer`; nothing here is
contract, so a host that only spawns plugins never imports it.

This package owns:

- the worker RPC server layer a plugin process launches — `workerServerLayer` and
  its `WorkerServerParams`;
- the Node module port the worker resolves the project's tooling through —
  `nodeModuleLayer`;
- the worker's own OTel bootstrap — `startWorkerTelemetry`, and the host's
  `startHostTelemetry`;
- the worker-options wire codec — `encodeWorkerOptions`, `decodeWorkerOptions`,
  `readWorkerOptionsFromEnv`;
- the trace-context middleware implementations that carry W3C
  `traceparent`/`tracestate` across the process split — `layerTraceContextClient`,
  `layerTraceContextServer`, `withLinkedSpan`, `tracePartsOf`.

The symbols these implement — the RPC groups, the payload schemas, the typed
errors, the spawn contract, and the trace-context contract
(`TraceContextMiddleware`, `PropagatedTrace`, `TracedRpc`) — are owned by
`@systemfsoftware/stryker-js-plugin-interface` and re-exported by nothing: a
consumer imports each symbol from the package that owns it.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-plugin-runtime
```

## The entry a plugin ships

`workerServerLayer` builds the `RpcServer` for one kind's RPC group over a socket
the host names in `STRYKER_SOCKET`, starts the worker's telemetry, and provides
the Node file system, the Node path service, `nodeModuleLayer`, and the
server-side trace-context middleware:

```ts
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { workerServerLayer } from '@systemfsoftware/stryker-js-plugin-runtime'

NodeRuntime.runMain(
  Layer.launch(
    workerServerLayer({ rpcs: TestRunnerRpcs, handlers: testRunnerHandlers, schemaServices: Layer.empty }),
  ).pipe(Effect.provideService(Logger.LogToStderr, true)),
)
```

## Worker options

The host writes the run's options to `options.json` in the worker directory it
creates; `readWorkerOptionsFromEnv` reads that file and decodes it into the same
`StrykerOptions` a local `stryker` run uses, so a worker's handlers see the run's
options without the host passing them over the wire.

## Trace context

A synchronous RPC call is the parent of the spans it invokes: the client
middleware injects the active trace context into the request headers as W3C
`traceparent`/`tracestate`, and the server middleware continues that trace for
the handler. Asynchronous plugin work — anything that outlives its call — is
linked instead of parented, through `withLinkedSpan`.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-plugin-runtime#readme).
