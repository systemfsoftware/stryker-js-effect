---
title: The lane's Tempo holds a trace uncut until 30 s after its last span because its 3.0.3 live store drops spans from traces it cuts early
date: 2026-09-28
category: test-failures
problem_type: collector silently loses a contiguous run of an accepted trace
input_shape: solution
subject: Tempo 3.0.3 in the pinned grafana/otel-lgtm image cuts a trace after 5 s idle or 30 s live, and a trace that outlives those windows loses whole export batches for good; the lifecycle contract then misses spans the CLI did emit
applies_when:
  - a lane trace contract breaks an `exists` or `descendant` conjunct and the exported trace lacks a contiguous slice of spans
  - the same tree passed on another run (the loss is timing-dependent)
  - bumping the `grafana/otel-lgtm` digest in `process-compose.yaml`
---

# The lane's Tempo holds a trace uncut until 30 s after its last span because its 3.0.3 live store drops spans from traces it cuts early

## Problem

CI run [36364734354](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/36364734354/job/108748777221)
(lane `e2e (lifecycle)`) broke `exists(stryker.cli.run)` with `inspected=[]`. The merged tree was identical to
the PR head, and the lane had passed on that head. The exported trace held 11,087 spans but not the host CLI's
last export: `stryker.cli.run`, `stryker.run_request`, `mutationTest`, every `stryker.mutationReporting.*` span,
`stryker.run.conclude` and the last two `stryker.mutant_run`s. The worker spans for those two mutants were
present, and the harness's `e2e.cli.run` span ended with status OK, so the CLI finished and exported normally.

## Failure mechanism

1. `process-compose.yaml` pins `grafana/otel-lgtm` v0.33.0, which runs Tempo 3.0.3. Its `tempo-config.yaml` sets
   no `live_store` block, so the live store uses its defaults: `max_trace_idle: 5s`, `max_trace_live: 30s` and
   `max_block_duration: 30s` (read from `/status/config` of that image).
2. A lifecycle trace lives about 105 to 118 s. The CLI and each worker export it through a `BatchSpanProcessor`,
   which sends 512 spans at a time or every 5 s, so the trace crosses both windows many times.
3. Tempo 3.0.3 permanently drops runs of consecutive batches from such a trace
   ([grafana/tempo#8002](https://github.com/grafana/tempo/issues/8002), open). Which run is dropped depends on
   timing. When it is the host's final flush, `stryker.cli.run` is gone; when it is a middle run, other conjuncts
   break or nothing checked is lost.

Reproduction: the passing run's trace (11,160 spans) was replayed with current timestamps on its original
timeline, as 27 batches shaped like the `BatchSpanProcessor` output, into a local copy of the pinned image while
it was read every second. With the defaults, Tempo kept 7,245 spans. With `max_trace_idle: 30s` and
`max_trace_live: 20m` it kept 11,160 of 11,160 and the trace was searchable.

Ruled out: `max_bytes_per_trace` (the passing trace was larger and was stored whole; the failing trace replayed
without gaps kept all 11,088 spans), and a CLI flush failure (the CLI exited as soon after its last span as it
did in the passing run, so no export was retrying or timing out).

## Architectural Invariants

- **A contract-read trace is never cut while it is still growing.** `tempo-live-store.yaml` sets
  `max_trace_idle: 30s`, above the largest gap between span ends measured in the lifecycle traces of the failing
  and passing runs (12.3 s), and `max_trace_live: 20m`, above the shard's `timeout 1200`. The setup and bake
  traces have gaps up to 307 s and are still cut; no contract reads them.
- **`max_block_duration` stays at its default.** A trace becomes searchable only once the live store has cut it
  and cut its block. With `max_block_duration: 20m`, a trace was still not searchable after 180 s; with the
  default, one burst was searchable after 32 s.
- **CI's trace artifact never comes from Tempo search.** Search lags a trace's last span by `max_trace_idle` plus
  one block, which made a search-based export wait 1.7–1.8 min per leg. The collector's `file` exporter
  (the `otelcol-capture.yaml` overlay) writes every received span to the artifact, complete once the collector
  shuts down (CI step `Capture traces`).
- **The snippet is appended to the image's own config at container start.** Tempo exposes no command-line flag
  for these settings (only `-live-store.complete-block-timeout`), so `process-compose.yaml` runs
  `cat tempo-live-store.yaml >> tempo-config.yaml && exec ./run-all.sh`. No image config is vendored. An image
  that ships its own `live_store` block fails Tempo startup with `field live_store already set in type
  app.Config`, so a digest bump cannot silently drop the override.
- **Drop the snippet once the pinned Tempo fixes #8002.**

## Verification

- The replay above against the pinned image with the snippet applied keeps every span.
- `pnpm lgtm:up`, then the lifecycle lane: the lane holds its trace contract, and `docker stop stryker-lgtm`
  leaves the lifecycle trace in the capture's `traces.jsonl`.
