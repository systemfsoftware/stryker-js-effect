# @systemfsoftware/stryker-js-plugin-runtime

The mutation-testing plugin **runtime** — the worker-side implementation of the
boundary described by
[`@systemfsoftware/stryker-js-plugin-interface`](../stryker-js-plugin-interface/README.md).
A plugin's `main.ts` launches this package's `workerServerLayer`; nothing here is
contract, so a host that only spawns plugins never imports it.

This package owns:

- the worker RPC server layer a plugin process launches — `workerServerLayer` and
  its `WorkerServerParams`;
- the telemetry a worker process exports with — the `WorkerTelemetryConfig`
  shape and the OTLP endpoint rule `TracesUrl` in
  `worker-telemetry.schema.ts`, read through the `WorkerTelemetry` service a
  worker's program root binds its own OTel SDK from;
- the worker-options wire schema — `WorkerOptionsWire` — and the
  `WorkerOptions` service a worker reads its `options.json` through;
- the trace-context middleware implementations that carry W3C
  `traceparent`/`tracestate` across the process split — `layerTraceContextClient`,
  `layerTraceContextServer`, `withLinkedSpan`, `tracePartsOf`,
  `partsOfEffectSpan`.

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

`Worker.workerServerLayer` builds the `RpcServer` for one kind's RPC group over a socket,
file system, and path the program root provides, restricts the socket file to
its owner, and provides the server-side trace-context middleware:

```ts
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'

NodeRuntime.runMain(
  Layer.launch(
    Worker.workerServerLayer({
      rpcs: Plugin.TestRunnerRpcs,
      handlers: testRunnerHandlers,
      schemaServices: Layer.empty,
    }),
  ).pipe(Effect.provideService(Logger.LogToStderr, true)),
)
```

## Worker options

The host writes the run's options to `options.json` in the worker directory it
creates; `Worker.WorkerOptions`, read through `Worker.WorkerOptions.layer`, decodes that file
into the same `StrykerOptions` a local `stryker` run uses, so a worker's
handlers see the run's options without the host passing them over the wire.

## Trace context

A synchronous RPC call is the parent of the spans it invokes: the client
middleware injects the active trace context into the request headers as W3C
`traceparent`/`tracestate`, and the server middleware continues that trace for
the handler. Asynchronous plugin work — anything that outlives its call — is
linked instead of parented, through `Trace.withLinkedSpan`.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-plugin-runtime#readme).
