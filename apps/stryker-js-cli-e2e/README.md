# `@systemfsoftware/stryker-js-cli-e2e`

Private end-to-end lane for the shipped `stryker` artifact. Installing the
packed tarball is the bed, not a journey: a broken install fails setup. The
lane exists for two behaviors observable only at the process boundary — a
mutation run through the packed runner and worker, and a lost machine-mode
envelope when the dry run fails. Everything below that seam is pinned by the
CLI's property suites and the engine's integration tests.

| Journey      | Test                             | Behavior it owns                                                                                                                         |
| ------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Mutation run | `tests/mutation-run.e2e.test.ts` | One real run through the packed runner plugin and the sandbox worker ends in a machine-mode `verdict` matching the hand-authored oracle. |
| Failing run  | `tests/failing-run.e2e.test.ts`  | A failing dry run crosses the boundary as the typed machine-mode `error` document with its classed exit code.                            |

Every run packs two workspace packages (`stryker-js-cli` and
`stryker-js-vitest-runner`) fresh with `pnpm pack` into a temp directory, starts
**one** digest-pinned `node:24-alpine` container through testcontainers, installs
the CLI tarball with `npm install -g` (the CLI bundle is self-contained),
installs the fixture's registry deps plus the runner tarball, and asserts exit
codes, the machine-mode event stream on stdout, and typed error documents — each
against a hand-authored oracle. No tarball, container state, or run output is
committed.

Machine-mode events go to stdout and also to `reports/mutation-stream.jsonl`
under the run's working directory. The lane observes stdout. The default plugin
glob `@systemfsoftware/stryker-js-*` resolves from the fixture's `node_modules`.
`--version` prints the CLI package version from the packed tarball's manifest.

A failing dry run is `RuntimeError`: exit code 3, terminal `error` event with a
non-empty `remediation`.

| Code | Class           | Meaning                                             |
| ---- | --------------- | --------------------------------------------------- |
| 0    | —               | The run completed; thresholds either passed or none |
| 1    | `VerdictFail`   | A configured threshold broke                        |
| 2    | `ConfigError`   | The config file or its options were rejected        |
| 3    | `RuntimeError`  | A run stage failed (dry run, checkers, workers)     |
| 4    | `InternalError` | An unforeseen internal failure                      |

## Layout

| Path                        | Why there                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tests/*.e2e.test.ts`       | The lane's journeys — plain vitest, no test-layer shape rules apply: they drive a packed artifact through a container. |
| `tests/__fixtures__/bed.ts` | The host-side bed: packs the CLI and runner, starts one container, installs the tarballs, asserts stdout.              |
| `testResources/`            | The fixture projects the container runs — the repo's home for SUT-consumed resources.                                  |
| `testResources/*/oracle.md` | Hand-derived expectations; a run may confirm them, never originate them.                                               |

## Run modes

Local podman (rootful socket + privileged Ryuk):

```bash
DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
```

CI Docker (ubuntu-latest ships Docker; `pnpm test:e2e` needs no env overrides):

```bash
pnpm test:e2e
```

## Observability

With OTel on, the lane's Vitest process exports traces to Grafana LGTM
(`experimental.openTelemetry` in `vitest.config.ts`, SDK in `otel.ts`). The
stack is a root process-compose unit over podman — not compose:

```bash
pnpm lgtm:up
OTEL_ENABLED=true DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') \
  TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
pnpm lgtm:down
```

Grafana is `http://127.0.0.1:3000` (admin/admin); explore Tempo for service
`stryker-js-cli-e2e`.

### CI telemetry artifact

The `e2e` job in `ci.yml` uploads `e2e-telemetry-<run>` on every run (missing
or empty fails the job). To inspect a CI run's traces locally:

```bash
pnpm lgtm:up
gh run download <run-id> -n e2e-telemetry-<run-id> -D /tmp/tele
tar xzf /tmp/tele/e2e-telemetry.tar.gz -C /tmp/tele
IN_DIR=/tmp/tele/e2e-telemetry node apps/stryker-js-cli-e2e/scripts/import-traces.mjs
```

Then query service `stryker-js-ci` in Grafana.

## CI

The lane stays out of `pnpm test` and `pnpm check:ci` by design (the app declares
no `test` script), so it needs its own job; it lives in `.github/workflows/ci.yml`
as the `e2e` job and uploads the `e2e-telemetry-<run-id>` artifact.
