---
title: The e2e lane judges traces it owns, minted per run and handed to the CLI as TRACEPARENT
date: 2026-09-26
category: best-practices
module: e2e-lane
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - writing or debugging an e2e journey that asserts on the packed CLI's spans in Tempo
  - changing the e2e harness, its global setup, or the remote trace observation settings
  - a trace-spec contract in the lane reports an absent, unfinished or missing trace
tags:
  - e2e-lane
  - trace-spec
  - tempo
  - traceparent
  - global-setup
---

# The e2e lane judges traces it owns, minted per run and handed to the CLI as TRACEPARENT

## Context

The lane runs the packed `stryker` CLI inside forked microVMs that export OTLP to the host's Grafana LGTM collector. The old lifecycle journey found "its" trace by polling Tempo search for recent span names, which could pick up another run's trace and could not say which run a span came from. The conversion to `@systemfsoftware/trace-spec` (plan `docs/plans/2026-09-26-1939-refactor-e2e-effect-spec-libraries-plan.md`) made every CLI run a trace-spec `Stimulus`, which works only because the CLI now continues a caller's trace.

## Guidance

- **Own the trace id, never search for it.** The harness stimulus `StrykerRun` is a `Stimulus.make`; trace-spec mints a random trace id and span id per call, and the harness passes the stimulus `traceparent` as `TRACEPARENT` in the CLI's per-run environment (`StrykerCliRunner.run`'s fourth argument). The CLI entrypoint decodes it through `environmentParentContext` and starts `stryker.cli.run` under `OtelTracer.makeExternalSpan`, so host and worker spans land in the owned trace. The contract then reads exactly `GET /api/v2/traces/<owned id>`.
- **Do not wrap the stimulus body in `underActiveTestSpan`.** It re-parents the harness seam spans (`e2e.fixture.install`, `e2e.cli.run`) onto the Vitest test span, so they land in the test's trace while the CLI's spans land in the owned one.
- **Keep trace-spec, gherkin-spec and `@systemfsoftware/vitest` out of `globalSetup`.** Importing any module that reaches `@systemfsoftware/vitest` from the lane's Vitest global setup fails before any test with `Vitest failed to find the current suite` (the fork registers an `afterAll` at import time, and global setup runs outside a suite). Shared settings the setup needs (the Tempo base URL, `tempoBaseUrl`) live in a plain module, and the harness layers (`HarnessServicesLive`, `HarnessPlatformLive`) live beside the harness services, so the bless script and global setup can use them too.
- **Expect each live journey to run its CLI twice.** `@systemfsoftware/vitest` re-runs every passing live test once on a fresh build as a leaked-state check, so a green journey shows two owned trace ids in Tempo, one per run.
- **Run one file with `pnpm --filter @systemfsoftware/stryker-e2e exec vitest run tests/<file>`.** `pnpm --filter … test:e2e -- tests/<file>` hands vitest a literal `--`, drops the filter, and runs every journey.

## Why This Matters

Remote observation in trace-spec (`RemoteObservation.layer` over `TempoTraceStore.source`) polls one trace id until the union of spans stays unchanged for the settle window, answers `absent` when nothing ever arrives, and ends at once when the source itself fails (`TempoTraceStore` applies `filterStatusOk`). Against the pinned `grafana/otel-lgtm` Tempo, an id that has not been ingested answers HTTP 200 with `{"trace":{},"metrics":{}}`, which reads as zero spans and keeps the poll going; a Tempo that answered 404 there would end the observation on the first read instead. With an owned id there is no other run's trace to confuse the contract with, and an empty answer means "not yet", not "someone else's".

The observation durations are `TRACE_POLL_INTERVAL`, `TRACE_SETTLE_WINDOW` and `TRACE_OBSERVATION_TIMEOUT` beside `TraceObservationLive`. A 20 s settle window held on the enterprise lifecycle traces (about 9,950 spans each) without an `IncompleteObservationError`.

## When to Apply

- Adding a trace assertion to any journey: judge the `StrykerRun` stimulus's own trace with a trace-spec contract, provided with `TraceObservationLive` as a scenario layer.
- Changing global setup: keep its imports free of the spec libraries.
- A contract reports `absent`: check that the CLI received `TRACEPARENT` (its `stryker.cli.run` must have the stimulus span as parent) before suspecting export or ingestion.

## Examples

A converted lifecycle `When` judges the run and yields both the verdict and the run output from one CLI invocation:

```ts
When('the enterprise lifecycle runs and its trace is judged')(
  'judgment',
  () => Contract.judge(strykerLifecycleContract, { fixture, label, args }),
)
```

A smoke of the carrier without the lane: run the built CLI (`main.mjs`) with `--version` with `OTEL_ENABLED=true` and `TRACEPARENT=00-<32 hex>-<16 hex>-01`, then read `/api/v2/traces/<32 hex>`; `stryker.cli.run`'s `parentSpanId` is the carried span id. Unset or malformed `TRACEPARENT` gives a fresh root.

## Related

- `docs/solutions/best-practices/vm-vitest-e2e-oracle-report-contract.md`: what the lane's report oracles may assert.
- The e2e lane's `AGENTS.md`: MicroVM environment and tracing notes.
