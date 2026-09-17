# `@systemfsoftware/stryker-js-cli-e2e`

End-to-end test suite for the packaged `@systemfsoftware/stryker-js-cli` binary.

These tests pack the CLI and Vitest runner packages into `.tgz` tarballs, install them inside a clean `node:24-alpine` container using testcontainers, and execute real `stryker run` commands against small fixture projects in `testResources/`.

## Test files

| Test                                      | What it checks                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/mutation-run.e2e.test.ts`          | Complete mutation run against a real fixture project. Verifies stdout JSON-lines stream, exit code 0, and survival counts against `testResources/mutation-fixture/oracle.md`. |
| `tests/failing-run.e2e.test.ts`           | Failing dry-run scenario (broken test). Verifies exit code 3 (`RuntimeError`) and the typed machine-mode error JSON output.                                                   |
| `tests/mixed-effect-versions.e2e.test.ts` | Worker compatibility when a checker plugin uses a different Effect version than the host CLI (`effect@4.0.0-rc.111` worker vs `rc.112` host).                                 |

## How it works

1. `tests/__fixtures__/bed.ts` packs `packages/stryker-js-cli` and `packages/stryker-js-vitest-runner` via `pnpm pack`.
2. Starts a `node:24-alpine` container with testcontainers.
3. Copies the fixture project into the container, installs the local tarballs as dependencies, and runs `npx stryker run`.
4. Asserts exit codes and parsed stdout JSON lines against the fixture's expected oracle.

Exit codes checked by the suite:

| Exit code | Error class     | Description                            |
| --------- | --------------- | -------------------------------------- |
| 0         | —               | Run completed successfully             |
| 1         | `VerdictFail`   | Mutation score dropped below threshold |
| 2         | `ConfigError`   | Invalid configuration file or options  |
| 3         | `RuntimeError`  | Dry run or test worker crashed         |
| 4         | `InternalError` | Unexpected process error               |

## Running locally

Local execution requires Docker or Podman with rootless/rootful socket enabled.

With Podman:

```bash
DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') \
TESTCONTAINERS_RYUK_PRIVILEGED=true \
pnpm test:e2e
```

With Docker:

```bash
pnpm test:e2e
```

To run a single test file:

```bash
cd apps/stryker-js-cli-e2e && pnpm exec vitest run tests/mixed-effect-versions.e2e.test.ts
```

## Tracing and telemetry

When `OTEL_ENABLED=true`, the container CLI and worker processes export traces to a local OpenTelemetry collector at `http://127.0.0.1:4318`.

To test with Grafana LGTM locally:

```bash
pnpm lgtm:up
OTEL_ENABLED=true DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') \
  TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
pnpm lgtm:down
```

View traces in Grafana at `http://127.0.0.1:3000` under the `stryker-js-cli-e2e` service.

### Inspecting CI traces

The GitHub Actions `e2e` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) uploads an `e2e-telemetry-<run-id>` artifact on every run. To import and inspect traces locally:

```bash
pnpm lgtm:up
gh run download <run-id> -n e2e-telemetry-<run-id> -D /tmp/tele
tar xzf /tmp/tele/e2e-telemetry.tar.gz -C /tmp/tele
IN_DIR=/tmp/tele/e2e-telemetry ./apps/stryker-js-cli-e2e/scripts/import-traces.ts
```
