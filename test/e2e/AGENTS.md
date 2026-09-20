# AGENTS.md — `@systemfsoftware/stryker-e2e`

Private E2E lane for the shipped `stryker` artifact: it packs the CLI and the
vitest-runner plugin fresh, installs the CLI tarball into one digest-pinned
`node:24-alpine` container, and asserts the published contract. Publishes no
artifact. Parent: `test/AGENTS.md`.

## Run

```bash
DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
```

## Rules

| ID        | Rule                                                                                                                                                                                                                                                                                         | Gate                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **E2E-1** | This app MUST NOT declare a `test` script: the lane runs only as its own `test:e2e` turbo task (`cache: false`), which is what keeps container-dependent tests out of `pnpm test`, `pnpm check:ci`, and the macOS CI matrix.                                                                 | `review` — `package.json` declares `test:e2e`, never `test`                                                       |
| **E2E-2** | Fixture oracles are authored literals in the journey that asserts them: a run may confirm the numbers, never originate them. A mismatch is triaged as a fixture-authoring error or a product bug, never auto-copied into the oracle.                                                         | `review` — every expected count appears as an authored literal in `tests/*.e2e.test.ts` (CONST-T10)               |
| **E2E-3** | The lane's assertions import no workspace package: they decode the machine stream's plain JSON events against authored expectations and read the trace over Tempo's HTTP API. A fixture _input_ under `testResources/` may import the published contract — a plugin cannot exist without it. | `review` — no workspace import under `tests/`; an import under `testResources/` names only the published contract |
| **E2E-4** | Each fixture declares every plugin it loads in its own `stryker.config.ts`. There is no plugin glob: that array is the only source of what loads.                                                                                                                                            | `review` — every `testResources/*/stryker.config.ts` names each plugin its run loads                              |
| **E2E-5** | The Effect-skew fixture plugin's worker release is the `SKEW_EFFECT_VERSION` pin in `tests/__fixtures__/bed.ts`, and the journey's trace expectation reads the same pin.                                                                                                                     | `review` — the `effect.version` the journey asserts equals `SKEW_EFFECT_VERSION`                                  |
| **E2E-6** | Diagnosing failing or flaky E2E runs MUST query Grafana LGTM traces (OTLP export to Tempo) to isolate the diverging span or event; adding ephemeral `console.log`/print statements or running blind reboot loops is prohibited.                                                              | `review` — diagnoses cite concrete span IDs or timestamps from Tempo; no temporary logging injected               |

## Lint scope

`oxlint.config.ts` sets oxlint's correctness category plus the strict trio every
package here sets. It deliberately does not extend `@systemfsoftware/all`: that
preset encodes the layers this app sits _below_ (suffix and shape rules for
`src/` workflow and property tests, the Gherkin requirement for behaviour files),
and none of them describe a lane that drives a packed artifact through a
container. `tests/__fixtures__/` is the repo's home for non-test helper modules
under `tests/`.

## Machine stream

The CLI writes machine-mode events to stdout and to `reports/mutation-stream.jsonl`
under the run's working directory. Journeys parse stdout.

## Container environment

Read by testcontainers; the `test:e2e` turbo task passes them through.

| Variable                         | Value                                                             | Why                                                                                           |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DOCKER_HOST`                    | `unix://$(podman info --format '{{.Host.RemoteSocket.Path}}')`    | Point testcontainers at the podman socket; leave unset under Docker.                          |
| `TESTCONTAINERS_RYUK_PRIVILEGED` | `true`                                                            | Rootful podman — Ryuk needs privilege to mount the root-owned socket.                         |
| `TESTCONTAINERS_RYUK_DISABLED`   | `true`                                                            | Rootless podman — Ryuk cannot run; the suite still stops its container in `afterAll`.         |
| `TESTCONTAINERS_HOST_OVERRIDE`   | host or IP                                                        | The hostname a container uses to reach the Docker host (remote daemon or CI-in-container).    |
| `OTEL_ENABLED`                   | `true` starts the CLI's, its workers' and the test process's SDKs | The Effect-skew journey grades the run's trace; the CI `e2e` job sets it                      |
| `OTEL_SERVICE_NAME`              | default `stryker-e2e`                                             | One service name across the CLI, its workers and the test process — what the journey searches |
| `OTEL_EXPORTER_OTLP_ENDPOINT`    | default `http://127.0.0.1:4318`                                   | The collector the container exports to                                                        |

`bed.ts` passes those three into every container exec, so a spawned worker inherits them. The bed's
container runs on the **host network**, which is what lets its loopback-bound collector be reached.

## Fixture plugins

`testResources/effect-skew-checker/` is a checker plugin the bed builds and packs at lane time: the
worker half is bundled with its own `effect` release (`SKEW_EFFECT_VERSION`) inlined, so it cannot be
re-consolidated with the CLI's release by any install layout. Its host half is a plain descriptor.
The bundle is produced by that fixture's `tsdown.config.mjs` through the vitest-runner package's
`tsdown` bin, with `SKEW_EFFECT_DIR`, `SKEW_RUNNER_MANIFEST` and `SKEW_OUT_DIR` supplied per build.
