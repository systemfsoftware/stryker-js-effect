---
title: An Effect metric is invisible until a MetricReader is registered
date: 2026-09-19
category: tooling-decisions
module: stryker-js-family
problem_type: tooling_decision
component: observability
severity: medium
applies_when:
  - "Wiring OpenTelemetry into an Effect program with NodeSdk.layer or WebSdk.layer"
  - "A Metric.update call runs, the run succeeds, and no metric reaches the backend"
  - "Deciding between a trace exporter alone and a trace exporter plus a MetricReader"
resolution_type: tooling_addition
tags: [opentelemetry, effect, metrics, metric-reader, otlp, telemetry, node-sdk]
---

# An Effect metric is invisible until a MetricReader is registered

## Problem

The checker boundary recorded Effect metrics - call durations, mutants checked, mutants skipped,
worker failures - and none of them ever left the process. Traces reached Tempo under
`OTEL_ENABLED=true`; metrics reached nothing, and nothing failed: `Metric.update` returned
normally, the registry recorded the value, and the process exited.

The wiring looked complete because it carried a span processor. A trace exporter and a metric
reader are separate registrations with separate defaults, and only one of them is required.

## Failure Mechanism

`NodeSdk.layer` treats metrics as opt-in. Inside the layer it binds:

```ts
const MetricsLayer = isNonEmpty(config.metricReader)
  ? Metrics.layer(constant(config.metricReader), { ... })
  : Layer.empty
```

An empty layer is a legal, silent configuration. Three properties make the failure mode durable:

1. **No type or compile signal.** `Metric.update` is typed identically whether or not a reader
   will ever collect its value.
2. **No runtime signal.** The update succeeds and the registry holds the measurement. Nothing
   reports that no reader is attached to that registry.
3. **Delayed observability.** The only evidence is a backend that stays empty - a signal that
   arrives after the run, in a system the author usually is not watching.

A test cannot see the difference either: a test that asserts a counter incremented passes
against a registry nobody reads. The distinction the author needs is _"a reader consumed it"_,
not _"the registry stored it"_.

## Architectural Invariants

**IV1 - A measurement has no consumer until a reader is attached.** For per-run programs, adding
a metric declaration or a `Metric.update` call is half a feature; the reader registration is the
other half, and the two must ship together.

**IV2 - The reader owns cadence and the shutdown flush, not the process lifetime.** The stock
periodic reader exports on its interval, and force-flushes when its owning scope closes. Export
interval and process lifetime are therefore independent variables: a process that lives for
seconds still delivers, and an interval longer than the process is not a bug.

```ts
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
  exportIntervalMillis: intervalMillis,
})

NodeSdk.layer(() => ({
  resource: { serviceName },
  metricReader,
  spanProcessor: new SimpleSpanProcessor(traceExporter),
}))
```

**IV3 - A teardown budget must outlast the work it bounds.** The shutdown flush happens inside
the teardown, so a teardown timeout shorter than one export request truncates the last flush.
The two constants are one budget expressed twice; derive one from the other rather than choosing
each independently, or a later edit to either silently reintroduces the loss. A teardown that
swallows its own cause makes that loss unobservable, so the finalizer reports what it abandoned.

## Verification

The claim "metrics are exported" is only provable end to end, because the declaration, the
update, the test, and the type all pass while nothing leaves the process. Run the real telemetry
layer against an in-process OTLP endpoint and assert a request arrives:

```ts
const telemetry = otlpTelemetryLayer({
  serviceName: 'probe',
  endpoint: serverUrl,
  metricExportIntervalMillis: 3_600_000,
})
await Effect.runPromise(
  Effect.gen(function*() {
    yield* Metric.update(checkerMutantsChecked, 1)
  }).pipe(Effect.provide(telemetry), Effect.scoped),
)
```

The hour-long interval is the point: the periodic timer never fires, so a request that still
arrives proves the shutdown flush rather than the schedule.

## Code Smells

- A telemetry layer constructed with a span processor and no `metricReader`.
- `Metric.update` calls beside an exported metric surface that no backend ever reports.
- A teardown timeout smaller than the exporter request timeout.
- A shutdown finalizer ending in a bare cause-ignoring combinator, so an abandoned flush looks
  like a clean exit.
- A test asserting a metric's registry value as evidence that metrics are exported.
