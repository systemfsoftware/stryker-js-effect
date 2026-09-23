# `@systemfsoftware/stryker-e2e`

MicroVM-isolated end-to-end tests for the packaged `@systemfsoftware/stryker-js` binary and its plugins.

## What it tests

The suite resolves the workspace closure of the CLI and its plugins, packs each member with `pnpm pack`, installs the whole closure into isolated fixture projects inside a preparation microVM, and runs every `stryker` invocation in its own one-shot [`@systemfsoftware/effect-microsandbox`](https://www.npmjs.com/package/@systemfsoftware/effect-microsandbox) job microVM to verify behavior across the process boundary:

- Full mutation runs against realistic test suites
- Exit codes and typed machine-mode JSON error envelopes on failure

## Running locally

Local runs need hardware virtualization and nothing else: no Docker daemon, Podman socket, or container CLI.

- **Linux:** a read/write `/dev/kvm`. When it exists but belongs to the `kvm` group, add yourself to that group (`sudo usermod -aG kvm "$USER"`, then log in again) or grant an ACL (`sudo setfacl -m u:"$USER":rw /dev/kvm`).
- **macOS:** Apple Silicon (Hypervisor.framework).
- **Inside a rootless podman container** (for example an agent sandbox run as a quadlet): add `AddDevice=/dev/kvm` to the unit's `[Container]` section, plus `GroupAdd=keep-groups` when the host's `/dev/kvm` is `root:kvm` mode `0660`, then `systemctl --user daemon-reload` and restart the unit.

```bash
pnpm test:e2e
```

Without usable virtualization the lane stops in global setup with a `VirtualizationUnsupportedError` naming the fix.

Run a specific test:

```bash
cd test/e2e && pnpm exec vitest run <path-to-test>
```

### Fixture cache

Global setup keys the baked fixtures on the base image, `tests/__fixtures__/bake-fixtures.sh`, the unpacked contents of every packed tarball, and every fixture source file. A hit reuses `node_modules/.cache/stryker-e2e/baked/<key>`; a miss re-bakes and prunes older keys. Editing a workspace package therefore re-bakes on the next run with no manual invalidation.

## Tracing and telemetry

When `OTEL_ENABLED=true`, test runs export OpenTelemetry traces to an OTLP collector on `http://127.0.0.1:4318`.

To run with local Grafana LGTM:

```bash
pnpm lgtm:up
OTEL_ENABLED=true pnpm test:e2e
pnpm lgtm:down
```

View traces in Grafana (`http://127.0.0.1:3000`) under the `stryker-e2e` service.

### Inspecting CI traces

CI workflows upload an `e2e-telemetry-<run-id>` artifact on every run. To import and inspect traces locally:

```bash
pnpm lgtm:up
gh run download <run-id> -n e2e-telemetry-<run-id> -D /tmp/tele
tar xzf /tmp/tele/e2e-telemetry.tar.gz -C /tmp/tele
IN_DIR=/tmp/tele/e2e-telemetry ./test/e2e/scripts/import-traces.ts
```
