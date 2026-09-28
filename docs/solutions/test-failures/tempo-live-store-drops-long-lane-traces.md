---
title: The lane's Tempo keeps traces live for the whole shard because its 3.0.3 live store drops spans from long traces
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

# The lane's Tempo keeps traces live for the whole shard because its 3.0.3 live store drops spans from long traces

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

Reproduction: the passing run's trace (11,160 spans) was replayed on its original timeline, as 27 batches shaped
like the `BatchSpanProcessor` output, into a local copy of the pinned image. With the defaults, Tempo kept 9,624
spans when the trace was read every second and 5,167 when it was never read. Re-reads over 60 s returned the
same counts. With the `live_store` windows raised, both variants kept 11,160 of 11,160.

Ruled out: `max_bytes_per_trace` (the passing trace was larger and was stored whole; the failing trace replayed
without gaps kept all 11,088 spans), and a CLI flush failure (the CLI exited as soon after its last span as it
did in the passing run, so no export was retrying or timing out).

## Architectural Invariants

- **Lane traces stay live for the whole shard.** `test/e2e/lgtm/tempo-config.yaml` sets `max_trace_idle`,
  `max_trace_live` and `max_block_duration` to 20m, the shard's `timeout 1200`. The longest lane trace measured
  in these runs lived 488 s.
- **The mounted file is the image's config plus that block.** Tempo exposes no command-line flag for these three
  settings (only `-live-store.complete-block-timeout`), so `TEMPO_EXTRA_ARGS` cannot set them and the whole
  file is mounted. The drift check is in `test/e2e/AGENTS.md`.
- **Drop the block once the pinned Tempo fixes #8002.**

## Verification

- The replay above against a stack from `pnpm lgtm:up` keeps every span.
- The lifecycle lane holds its trace contract.
