# `@systemfsoftware/stryker-e2e`

MicroVM-isolated end-to-end tests for the packaged `@systemfsoftware/stryker-js` binary and its plugins.

## What it tests

The suite builds the flake's `stryker` package (`nix build .#stryker`), the CLI with every plugin it ships, and runs every `stryker` invocation in its own [`@systemfsoftware/effect-microsandbox`](https://github.com/systemfsoftware/effect-microvm) microVM to verify behavior across the process boundary:

- Full mutation runs against realistic test suites
- Exit codes and typed machine-mode JSON error envelopes on failure

A preparation microVM bakes each fixture: one `npm ci` from its committed `package-lock.json` installs the fixture's own dependencies, then the package's `lib` tree is copied to `node_modules/.stryker`, with `node_modules/@systemfsoftware/stryker-js` and `node_modules/.bin/stryker` linked into it. A fixture names no `@systemfsoftware` stryker package in its manifest; its config names plugins by their bare names, which the CLI resolves from its own install. `calc-fixture` loads both Effect ignorers, so a plugin the package cannot load fails the lane. The bake cache is keyed by the package's store path, the base image, the bake script and each fixture's files.

When a fixture's dependency range no longer matches its lock, or the lock is missing, the bake fails with `npm ci`'s own error and a line naming the fix: run `pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock` and commit the result.

## Running locally

Local runs need hardware virtualization and nothing else: no Docker daemon, Podman socket, or container CLI.

- **Linux:** a read/write `/dev/kvm`. When it exists but belongs to the `kvm` group, add yourself to that group (`sudo usermod -aG kvm "$USER"`, then log in again) or grant an ACL (`sudo setfacl -m u:"$USER":rw /dev/kvm`).
- **macOS:** Apple Silicon (Hypervisor.framework).
- **Inside a rootless podman container** (for example an agent sandbox run as a quadlet): add `AddDevice=/dev/kvm` to the unit's `[Container]` section, plus `GroupAdd=keep-groups` when the host's `/dev/kvm` is `root:kvm` mode `0660`, then `systemctl --user daemon-reload` and restart the unit.

The collector (Grafana LGTM with Tempo) is mandatory: without it, global setup fails naming the remediation.

```bash
pnpm test:e2e
```

Without usable virtualization the lane stops in global setup with a `VirtualizationUnsupportedError` naming the fix.

CI runs the lane postsubmit: `.github/workflows/e2e.yml` runs its five legs on every push to `main` (except a release commit pushed by `github-actions[bot]`) and on `workflow_dispatch`, and no pull-request workflow runs it.

Run a specific test:

```bash
OTEL_ENABLED=true pnpm --filter @systemfsoftware/stryker-e2e exec vitest run tests/<file>
```

### Fixture cache

Global setup keys the prepared fixtures on two inputs: the package (base image, `tests/__fixtures__/bake-fixtures.sh`, and the store path of the flake's `stryker` package) and, separately, each fixture's own source files with its manifests resolved against the catalogs in the repo-root `pnpm-workspace.yaml`. The cache holds `node_modules/.cache/stryker-e2e/baked/<packs-key>/<fixtureId>.<fixture-key>`, so editing one fixture re-bakes that fixture alone; editing a workspace package or a catalog entry builds a new store path and re-bakes its fixture set, with no manual invalidation.

A run leases its entry for as long as it lives and prunes unleased entries of other keys from its global teardown, so concurrent runs sharing the cache do not delete each other's entries.

### Warm snapshots and forks

Each test file boots one warm microVM per fixture, copies the baked fixture onto the guest disk at `/work`, captures a full microsandbox snapshot, and stops the VM. Every `fixture.run(...)` then restores a copy-on-write fork of that snapshot, so each run starts from the same clean `/work` without a cold boot or a copy. `fixture.readFile(...)` reads from the fork of the fixture's most recent run. Forks are destroyed when their test ends, and the snapshot is removed when the file ends.

## Tracing and telemetry

Each test scenario runs the CLI under a trace id it owns, passed to the CLI as `TRACEPARENT`, so the CLI's and its workers' spans land in that trace. Failure annotations name the trace id. The lifecycle feature also judges its run against a declared trace contract over spans read back from Tempo; a Break writes a dump under `test/e2e/artifacts/traces/` (gitignored).

`OTEL_ENABLED` is forced to `true` by global setup; the collector must be available at `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://127.0.0.1:4318`) and Tempo at `TEMPO_URL` (`http://127.0.0.1:3200`). Observation settings (poll interval, settle window, timeout) are configured in `trace-observation.fixture.ts`.

To run with local Grafana LGTM:

```bash
pnpm lgtm:up
pnpm test:e2e
pnpm lgtm:down
```

View traces in Grafana (`http://127.0.0.1:3000`) under the `stryker-e2e` service. Query by trace id from a failure annotation to isolate diverging spans.

### Inspecting CI traces

CI workflows upload an `e2e-telemetry-<run-id>` artifact on every run. To import and inspect traces locally:

```bash
pnpm lgtm:up
gh run download <run-id> -n e2e-telemetry-<run-id> -D /tmp/tele
tar xzf /tmp/tele/e2e-telemetry.tar.gz -C /tmp/tele
IN_DIR=/tmp/tele/e2e-telemetry ./test/e2e/scripts/import-traces.ts
```

## Runbook

### Diagnosing a failing or flaky run

Query Grafana LGTM traces (OTLP export to Tempo) to isolate the diverging span or event; do not add logging or retry blind.

- Each CLI invocation runs under a trace id the test owns, passed to the CLI as `TRACEPARENT`; a failure report names the id.
- If Tempo holds no guest trace, first verify the collector endpoint is reachable from inside the guest: the lane rewrites the endpoint's loopback host to `host.microsandbox.internal` (`StrykerCliRunner`), which only works when the collector is published beyond loopback.
- Ephemeral `console.log`/print statements under `tests/` are a lint error (`no-console`), so temporary logging is not the fallback.

### Diagnosing a bundle defect

The lane runs the package's `dist/main.mjs`, not workspace source. A worker failure that cannot be reproduced from source is a bundle defect (an unresolvable import, or a tree-shaken combinator compiling to `(void 0)`): read the bundle line in the stack before blaming source. The image uses a fixed tag, so a run may adopt bundles baked before your edit — after changing a workspace package, clear the baked cache (`rm -rf node_modules/.cache/stryker-e2e/baked`) before trusting a verdict.
