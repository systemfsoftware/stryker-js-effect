# `@systemfsoftware/stryker-js-cli-e2e`

Container-isolated end-to-end tests for the packaged `@systemfsoftware/stryker-js-cli` binary and plugins.

## What it tests

The suite packages workspace components into tarballs (`pnpm pack`), starts a clean container, installs the tarballs into isolated fixture projects, and runs `stryker run` to verify behavior across the process boundary:

- Full mutation runs against realistic test suites
- Exit codes and typed machine-mode JSON error envelopes on failure
- Worker RPC compatibility across different Effect dependency versions

## Running locally

Local runs require Docker or Podman with an active socket.

With Docker:

```bash
pnpm test:e2e
```

With Podman:

```bash
DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') \
TESTCONTAINERS_RYUK_PRIVILEGED=true \
pnpm test:e2e
```

Run a specific test:

```bash
cd apps/stryker-js-cli-e2e && pnpm exec vitest run <path-to-test>
```

## Tracing and telemetry

When `OTEL_ENABLED=true`, test runs export OpenTelemetry traces to an OTLP collector on `http://127.0.0.1:4318`.

To run with local Grafana LGTM:

```bash
pnpm lgtm:up
OTEL_ENABLED=true pnpm test:e2e
pnpm lgtm:down
```

View traces in Grafana (`http://127.0.0.1:3000`) under the `stryker-js-cli-e2e` service.

### Inspecting CI traces

CI workflows upload an `e2e-telemetry-<run-id>` artifact on every run. To import and inspect traces locally:

```bash
pnpm lgtm:up
gh run download <run-id> -n e2e-telemetry-<run-id> -D /tmp/tele
tar xzf /tmp/tele/e2e-telemetry.tar.gz -C /tmp/tele
IN_DIR=/tmp/tele/e2e-telemetry ./apps/stryker-js-cli-e2e/scripts/import-traces.ts
```
