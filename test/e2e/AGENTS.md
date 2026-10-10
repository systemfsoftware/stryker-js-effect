# AGENTS.md — `@systemfsoftware/stryker-e2e`

Private E2E lane for the shipped `stryker` artifact: it packs the workspace closure, bakes every fixture's
`npm install` in a preparation microVM into a content-addressed host cache, boots one warm
`@systemfsoftware/effect-microsandbox` microVM per test file and fixture on the digest-pinned `node:24-alpine` image,
copies the baked fixture onto its disk at `/work`, snapshots it, and runs each engine invocation in a fresh
copy-on-write fork of that snapshot. Publishes no artifact. Parent: `test/AGENTS.md`.

## Run

```bash
pnpm test:e2e
```

## Rules

| ID        | Rule                                                                                                                                                                                                                                                                                                                                                                            | Gate                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E2E-1** | This app MUST NOT declare a `test` script: the lane runs only as its own `test:e2e` turbo task (`cache: false`), which is what keeps container-dependent tests out of `pnpm test`, `pnpm check:ci`, and the macOS CI matrix. It also MUST resolve every journey the witness registry names to an existing file.                                                                 | `pnpm test` → `test/e2e-core/tests/status-closure.integration.test.ts` fails on a registry journey whose file is missing or unreadable. A `test` script fails loudly on its own: CI `check` would run the container journeys, and it has no LGTM stack or microVM |
| **E2E-2** | Fixture expectations are authored claims in fixture source: every mutant a run reports MUST match exactly one `@stryker-expect` annotation in the fixture under test (line, block or declaration, or file scope, nearest scope wins), and an unmatched mutant, an unclaimed annotation, or a double claim at one scope fails the run. No expected value is recorded from a run. | `pnpm test` → the annotation parser, matcher, closure and confirmation laws in `@systemfsoftware/stryker-e2e-core`; the lane journeys assert through `tests/__fixtures__/annotation-oracle.fixture.ts`                                                            |
| **E2E-3** | Files under `test/e2e/tests/` MUST import no Stryker implementation package, type-only imports included: they decode the packed CLI through the contract packages, `@systemfsoftware/stryker-e2e-core`, test tooling and the lane's own harness. A fixture _input_ under `testResources/` may import the published contract — a plugin cannot exist without it.                 | `pnpm lint` → the `no-restricted-imports` override in `test/e2e/oxlint.config.ts` bans every implementation package under `tests/**`                                                                                                                              |
| **E2E-6** | The lane MUST NOT add ephemeral `console.log`/print statements under `tests/`. The trace-diagnosis runbook lives in `README.md`.                                                                                                                                                                                                                                                | `pnpm lint` → the `no-console` override in `test/e2e/oxlint.config.ts` applies to `tests/**`                                                                                                                                                                      |
| **E2E-8** | The bake cache is keyed per fixture, never per fixture set: a fixture's entry (`<packs-key>/<fixtureId>.<fixture-key>`) depends on the packed closure and that fixture's own files, so editing one fixture rebakes that fixture alone. A run leases its entry for its lifetime and prunes only entries it neither uses nor finds leased, from its teardown.                     | `pnpm test` → the cache-key laws in `@systemfsoftware/stryker-e2e-core`: the `key-material` in-source laws (packs and fixture keys) and the `missing-fixtures` and `prune-stale-entries` workflow property tests                                                  |

## Lint scope

`oxlint.config.ts` sets oxlint's correctness category plus the strict trio every
package here sets. It deliberately does not extend `@systemfsoftware/all`: that
preset encodes the layers this app sits _below_ (suffix and shape rules for
`src/` workflow and property tests, the Gherkin requirement for behaviour files),
and none of them describe a lane that drives a packed artifact through a
microVM. `tests/__fixtures__/` is the repo's home for non-test helper modules
under `tests/`.

## Machine stream

The CLI writes machine-mode events to stdout and to `reports/mutation-stream.jsonl`
under the run's working directory. Journeys decode stdout through `tests/__fixtures__/machine-stream.fixture.ts`.

## MicroVM environment

Read by the harness services in `src/Harness/`; the `test:e2e` turbo task passes the OTEL variables through.

| Variable                         | Value                            | Why                                                                                                                                      |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_ENABLED`                   | forced to `true` by global setup | Every CLI run exports its trace, and the lifecycle feature judges one; a run refuses an explicit `false`                                 |
| `OTEL_SERVICE_NAME`              | default `stryker-e2e`            | One service name across the CLI, its workers and the test process                                                                        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`    | default `http://127.0.0.1:4318`  | The host collector each forked microVM exports to                                                                                        |
| `TEMPO_URL`                      | default `http://127.0.0.1:3200`  | Tempo's HTTP API; the lifecycle contract reads `/api/v2/traces/{id}` from this base URL (read in `tests/__fixtures__/tempo-endpoint.ts`) |
| `STRYKER_E2E_BAKED_ROOT`         | set by global setup              | The baked cache entry every warm microVM copies its fixture from                                                                         |
| `STRYKER_E2E_BAKED_FIXTURE_KEYS` | set by global setup              | The per-fixture bake keys, so a worker resolves `<fixtureId>.<key>` inside that entry                                                    |

Global setup probes Tempo's readiness at `TEMPO_URL` before any test runs; a run fails if the collector is unreachable, naming the remediation `pnpm lgtm:up`. `StrykerCliRunner` passes the OTEL variables into every forked run, so a spawned worker inherits them. Each fork is restored with host access, and the endpoint's loopback host is rewritten to `host.microsandbox.internal`, so the collector must publish 4318 beyond loopback.

`pnpm lgtm:up` appends `lgtm/tempo-live-store.yaml` to the image's own Tempo config before the stack starts; it keeps a lane trace in Tempo's live store until 30 s after its last span, working around Tempo 3.0.3 dropping spans from traces its live store cuts early ([why](../../docs/solutions/test-failures/tempo-live-store-drops-long-lane-traces.md)). It also merges `lgtm/otelcol-capture.yaml` into the collector's config, so every received span is written to `e2e-telemetry/capture/traces.jsonl`; the file is complete once `docker stop stryker-lgtm` returns and `capture/otelcol.log` holds `Shutdown complete.` (CI step `Capture traces` fails with a `TRACE_CAPTURE_*` code otherwise). The overlay's traces pipeline lists Tempo's exporter too, because a config merge replaces lists. Nothing reads Tempo search to export traces; replay a leg with the README's "Inspecting CI traces".

Each CLI invocation runs as a trace-spec `Stimulus` under a trace id the test owns, passed to the CLI as `TRACEPARENT` in its environment. The harness annotates the Vitest task with `trace <id>`; a failure report names the id, and a contract Break also writes a dump under `test/e2e/artifacts/traces/`. The harness exports its own seam spans (setup, pack, keys, bake, fixture install, guest job, CLI run) into the same trace. Observation settings (`TRACE_POLL_INTERVAL`, `TRACE_SETTLE_WINDOW`, `TRACE_OBSERVATION_TIMEOUT`) live in `tests/__fixtures__/trace-observation.fixture.ts`.
