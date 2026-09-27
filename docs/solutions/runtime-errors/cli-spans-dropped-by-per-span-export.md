---
title: The CLI exports spans in batches because per-span export drops spans under load
date: 2026-09-27
category: runtime-errors
problem_type: telemetry spans silently dropped by the OTLP exporter concurrency limit
input_shape: solution
subject: A SimpleSpanProcessor sends one OTLP request per ended span, the exporter refuses any export past 30 in flight, and a run against a slow collector loses a random subset of its spans
applies_when:
  - choosing or changing the span processor in the CLI telemetry layer
  - a lane trace contract fails a `descendant` relation while every `exists` conjunct holds
  - two runs of the same journey export different span counts for identical work
---

# The CLI exports spans in batches because per-span export drops spans under load

## Problem

The lifecycle journey passed, then failed its fresh-services rerun on the trace
contract. Every `exists` conjunct held; the `descendant` relations from
`stryker.cli.run` to `prepare`, `instrument`, `dryRun`, `mutationTest`,
`mutationTest.batch`, `rpc.capabilities` and `rpc.dryRun` broke. The exported
trace of the failing run had no `stryker.run_request` or
`stryker.run_request.write` span, the parents that link those phases to
`stryker.cli.run`, and nine fewer spans than the passing run. `stryker.cli.run`
itself, which ends after both, was present, so the loss was not a short final
flush.

## Failure mechanism

1. The CLI telemetry layer used a `SimpleSpanProcessor`, which calls the
   exporter once for every ended span. A mutation run ends about eleven
   thousand spans, several hundred at a time while the checker settles.
2. The OTLP HTTP exporter bounds in-flight exports (`concurrencyLimit`,
   default 30). An export requested past that bound returns `FAILED`
   ("Concurrent export limit reached") and the span is discarded; nothing
   retries it.
3. On a runner where each request is slow, more than thirty requests are
   pending during a burst, so a different subset of spans is lost each run. A
   throwaway probe against a collector answering in 300 ms delivered 30 of 400
   spans through the simple processor and 400 of 400 through a batch processor.

## Architectural Invariants

- **Spans leave the CLI in batches.** The telemetry layer registers a
  `BatchSpanProcessor`, which sends up to 512 spans per request, so a run needs
  tens of requests and never approaches the exporter's in-flight bound.
- **Shutdown flushes the queue within the telemetry shutdown budget.** The
  final flush sends the few batches still queued; the shutdown timeout stays
  above one export timeout.
- **A partial trace is a product defect before it is a test leak.** A trace
  contract that fails on missing parents while its spans exist points at span
  delivery; compare the exported span sets of the passing and failing runs
  before suspecting the harness.

## Verification

- The lane's lifecycle journey reruns on fresh services and holds its trace
  contract on both runs.
- Code smell: `SimpleSpanProcessor` wrapping a network exporter outside a test,
  where an in-memory exporter makes per-span export correct.
