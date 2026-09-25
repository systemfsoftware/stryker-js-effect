# AGENTS.md — `@systemfsoftware/stryker-e2e`

Private E2E lane for the shipped `stryker` artifact: it packs the workspace closure, bakes every fixture's
`npm install` in a preparation microVM into a content-addressed host cache, and runs each engine invocation
as a one-shot `@systemfsoftware/effect-microsandbox` job microVM on the digest-pinned `node:24-alpine` image
against a fresh host-side workspace mounted at `/work`. Publishes no artifact. Parent: `test/AGENTS.md`.

## Run

```bash
pnpm test:e2e
```

## Rules

| ID        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gate                                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E2E-1** | This app MUST NOT declare a `test` script: the lane runs only as its own `test:e2e` turbo task (`cache: false`), which is what keeps container-dependent tests out of `pnpm test`, `pnpm check:ci`, and the macOS CI matrix.                                                                                                                                                                                                                                                                                                              | `review` — `package.json` declares `test:e2e`, never `test`                                                                                                                                  |
| **E2E-2** | Fixture oracles are authored literals in the journey that asserts them: a run may confirm the numbers, never originate them. A mismatch is triaged as a fixture-authoring error or a product bug, never auto-copied into the oracle.                                                                                                                                                                                                                                                                                                      | `review` — every expected count appears as an authored literal in `tests/*.e2e.test.ts` (CONST-T10)                                                                                          |
| **E2E-3** | The lane's assertions import no workspace package: they decode the machine stream's plain JSON events against authored expectations and read the trace over Tempo's HTTP API. A fixture _input_ under `testResources/` may import the published contract — a plugin cannot exist without it.                                                                                                                                                                                                                                              | `review` — no workspace import under `tests/`; an import under `testResources/` names only the published contract                                                                            |
| **E2E-4** | Each fixture declares every plugin it loads in its own `stryker.config.ts`. There is no plugin glob: that array is the only source of what loads.                                                                                                                                                                                                                                                                                                                                                                                         | `review` — every `testResources/*/stryker.config.ts` names each plugin its run loads                                                                                                         |
| **E2E-6** | Diagnosing failing or flaky E2E runs MUST query Grafana LGTM traces (OTLP export to Tempo) to isolate the diverging span or event; adding ephemeral `console.log`/print statements or running blind reboot loops is prohibited. If Tempo holds no guest trace, first verify the collector endpoint is reachable from inside the guest: the lane rewrites the endpoint's loopback host to `host.microsandbox.internal` (`StrykerCliRunner`), which only works when the collector is published beyond loopback.                             | `review` — diagnoses cite concrete span IDs or timestamps from Tempo; no temporary logging injected                                                                                          |
| **E2E-7** | The lane runs the packed `dist/main.mjs`, not workspace source: a worker failure that cannot be reproduced from source is a bundle defect (unresolvable import, or a tree-shaken combinator compiling to `(void 0)`) — read the packed-bundle line in the stack before blaming source. The image uses a fixed tag, so a run may adopt bundles baked before your edit — after changing a workspace package force an honest rebuild by clearing the baked cache (`rm -rf node_modules/.cache/stryker-e2e/baked`) before trusting a verdict. | `review` — diagnosis cites the packed-bundle line, and a forced rebuild precedes any verdict on fresh source changes                                                                         |
| **E2E-8** | The bake cache is keyed per fixture, never per fixture set: a fixture's entry (`<packs-key>/<fixtureId>.<fixture-key>`) depends on the packed closure and that fixture's own files, so editing one fixture rebakes that fixture alone. A run leases its entry for its lifetime and prunes only entries it neither uses nor finds leased, from its teardown.                                                                                                                                                                               | `review` — `fixture-cache.service.ts` derives the packs key and the per-fixture keys, `bake` stages only the missing fixtures, and `pruneStaleEntries` runs from the teardown behind a lease |

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
under the run's working directory. Journeys parse stdout.

## MicroVM environment

Read by the harness services in `src/Harness/`; the `test:e2e` turbo task passes the OTEL variables through.

| Variable                         | Value                                                             | Why                                                                                           |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `OTEL_ENABLED`                   | `true` starts the CLI's, its workers' and the test process's SDKs | The lifecycle journey grades the run's trace; the CI `e2e` job sets it                        |
| `OTEL_SERVICE_NAME`              | default `stryker-e2e`                                             | One service name across the CLI, its workers and the test process — what the journey searches |
| `OTEL_EXPORTER_OTLP_ENDPOINT`    | default `http://127.0.0.1:4318`                                   | The host collector the job microVM exports to                                                 |
| `STRYKER_E2E_BAKED_ROOT`         | set by global setup                                               | The baked cache entry for the packed closure every worker copies its fixture workspaces from  |
| `STRYKER_E2E_BAKED_FIXTURE_KEYS` | set by global setup                                               | The per-fixture bake keys, so a worker resolves `<fixtureId>.<key>` inside that entry         |

`StrykerCliRunner` passes the OTEL variables into every job microVM, so a spawned worker inherits them.
Each job opts into host access, and the endpoint's loopback host is rewritten to `host.microsandbox.internal`,
so the collector must publish 4318 beyond loopback (`process-compose.yaml` does).
The harness exports its own seam spans (setup, pack, keys, bake, fixture install, guest job, CLI run) to the
same collector under `OTEL_ENABLED`.
