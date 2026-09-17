# `@systemfsoftware/stryker-js-cli-e2e`

End-to-end lane for the shipped `stryker` artifact. It proves the thing users
install — the packed tarball — actually runs: a real container, a real worker
process, a real verdict on stdout. Everything observable below that seam is
pinned by the CLI's property suites and the engine's integration tests; this
lane owns only what dies at the process boundary.

## Journeys

| Journey               | Test                                      | What it proves                                                                                                                              |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutation run          | `tests/mutation-run.e2e.test.ts`          | One real run through the packed runner plugin and sandbox worker ends in a machine-mode `verdict` matching the hand-authored oracle.        |
| Failing run           | `tests/failing-run.e2e.test.ts`           | A failing dry run crosses the boundary as the typed machine-mode `error` document with its classed exit code.                               |
| Mixed Effect versions | `tests/mixed-effect-versions.e2e.test.ts` | A checker worker bundled against a different Effect release than the CLI still boots, answers checks, and finishes on the oracle's verdict. |

## How a run works

Every run packs two workspace packages (`stryker-js-cli` and
`stryker-js-vitest-runner`) fresh with `pnpm pack` into a temp directory, starts
**one** digest-pinned `node:24-alpine` container through testcontainers, and
installs the fixture's registry dependencies plus the CLI and runner tarballs
into the fixture itself — the same shape as a project that lists Stryker and its
plugins as devDependencies. Journeys invoke the local bin with `npx` and assert
exit codes, the machine-mode event stream on stdout, and typed error documents,
each against a hand-authored oracle. No tarball, container state, or run output
is committed.

Each fixture names the plugins its run loads in its own `stryker.config.ts` —
that array is the only source of what loads — and they resolve from the
fixture's `node_modules`. Machine-mode events go to stdout and to
`reports/mutation-stream.jsonl` under the run's working directory; the lane
observes stdout.

> [!NOTE]
> Nothing the lane produces is committed — no tarball, container state, or run
> output. A journey that needs a stored input reads it from `testResources/`.

The exit codes the lane asserts:

| Code | Class           | Meaning                                             |
| ---- | --------------- | --------------------------------------------------- |
| 0    | —               | The run completed; thresholds either passed or none |
| 1    | `VerdictFail`   | A configured threshold broke                        |
| 2    | `ConfigError`   | The config file or its options were rejected        |
| 3    | `RuntimeError`  | A run stage failed (dry run, checkers, workers)     |
| 4    | `InternalError` | An unforeseen internal failure                      |

## Layout

| Path                        | What lives there                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/*.e2e.test.ts`       | The journeys — plain vitest driving a packed artifact through a container.                                                            |
| `tests/__fixtures__/bed.ts` | The host-side bed: packs the packages, starts one container, installs the tarballs, runs the CLI.                                     |
| `testResources/`            | The fixture projects the container runs. `effect-skew-checker/` is the differently-versioned checker plugin the bed builds and packs. |
| `testResources/*/oracle.md` | Hand-derived expectations; a run may confirm them, never originate them.                                                              |

## Run modes

Local podman (rootful socket + privileged Ryuk):

```bash
DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
```

CI Docker (ubuntu-latest ships Docker; no env overrides needed):

```bash
pnpm test:e2e
```

The lane stays out of `pnpm test` and `pnpm check:ci` by design — the app
declares no `test` script — so CI runs it as its own `e2e` job in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Observability

With `OTEL_ENABLED=true`, the container's CLI, its worker processes, and the
lane's Vitest process all export traces to Grafana LGTM. The container runs on
the host network, so the loopback-bound collector is reachable from inside it.
The mixed-versions journey reads the run's trace back from Tempo to assert the
differently-versioned worker linked into the host's trace.

```bash
pnpm lgtm:up
OTEL_ENABLED=true DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') \
  TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
pnpm lgtm:down
```

Grafana is `http://127.0.0.1:3000` (admin/admin); explore Tempo for service
`stryker-js-cli-e2e`.

### CI telemetry artifact

The `e2e` job uploads `e2e-telemetry-<run-id>` on every run; missing or empty
fails the job. To inspect a CI run's traces locally:

```bash
pnpm lgtm:up
gh run download <run-id> -n e2e-telemetry-<run-id> -D /tmp/tele
tar xzf /tmp/tele/e2e-telemetry.tar.gz -C /tmp/tele
IN_DIR=/tmp/tele/e2e-telemetry ./apps/stryker-js-cli-e2e/scripts/import-traces.ts
```

Then query service `stryker-js-ci` in Grafana.
