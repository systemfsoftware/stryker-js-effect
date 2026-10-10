# `@systemfsoftware/stryker-e2e`

MicroVM-isolated end-to-end tests for the packaged `@systemfsoftware/stryker-js` binary and its plugins.

## What it tests

The suite resolves the workspace closure of the CLI and its plugins, packs each member with `pnpm pack`, installs the whole closure into isolated fixture projects inside a preparation microVM, and runs every `stryker` invocation in its own [`@systemfsoftware/effect-microsandbox`](https://www.npmjs.com/package/@systemfsoftware/effect-microsandbox) microVM to verify behavior across the process boundary:

- Full mutation runs against realistic test suites
- Exit codes and typed machine-mode JSON error envelopes on failure

Each fixture installs its committed `package-lock.json` with one `npm ci`, and no `@systemfsoftware` workspace package comes from the registry. The staged fixture manifest lists every packed closure member, plus one entry per alias edge between members, as a `file:` dependency on its versionless tarball, `../../packs/<scope>-<name>.tgz` (`stagedFixtureOf` and `installClosure` in `@systemfsoftware/stryker-e2e-core`). The alias entries exist because `pnpm pack` rewrites a workspace alias (`"@systemfsoftware/stryker-js-vm-runner": "workspace:@systemfsoftware/stryker-js-vitest-runner@^"`) to `npm:<target>@^<version>`, which npm would otherwise resolve from the registry. Global setup fails, naming the edge, instead of reaching the registry when a packed member depends on a workspace package the closure did not pack (`UnpackedWorkspaceDependency`), when one alias name would install two different packages (`ConflictingAliasTargets`), or when a fixture manifest names a workspace package itself (`FixtureNamesWorkspacePackage`). The closure is staged into every fixture, so a fixture never names it.

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

Run a specific test:

```bash
OTEL_ENABLED=true pnpm --filter @systemfsoftware/stryker-e2e exec vitest run tests/<file>
```

### Fixture cache

Global setup keys the prepared fixtures on two inputs: the packed closure (base image, `test/e2e-core/bake/bake-fixtures.sh`, and the unpacked contents of every packed tarball) and, separately, each fixture's own source files, its committed lock included, with its manifests staged the way the bake installs them. The cache holds `node_modules/.cache/stryker-e2e/baked/<packs-key>/<fixtureId>.<fixture-key>`, so editing one fixture re-bakes that fixture alone; editing a workspace package or a catalog entry lands a new closure key and re-bakes its fixture set, with no manual invalidation.

A run leases its entry for as long as it lives and prunes unleased entries of other keys from its global teardown, so concurrent runs sharing the cache do not delete each other's entries.

### Committed fixture locks

Every fixture under `testResources/` commits a `package-lock.json`, and the bake installs it with `npm ci`, so the bake makes no resolution choice and a new registry release cannot change a fixture. Closure members appear in the lock as `file:` entries without `version` or `integrity`, so a workspace release leaves every lock unchanged and `npm ci` installs the freshly packed tarball.

Regenerate the locks after changing a fixture manifest, a catalog entry, an `effect` or `@effect/*` version in `pnpm-lock.yaml`, or a closure member's dependencies, then commit them:

```bash
pnpm --filter @systemfsoftware/stryker-e2e-core fixtures:lock
```

The `@systemfsoftware/stryker-e2e-core` `test` task checks every lock offline against the staged manifest, the packed closure and the root pins, and prints one `E2E_PINS_DRIFT: <fixture>: <finding>. Next: …` line per problem, so a stale lock fails `check` before any e2e lane runs.

Each `npm ci` runs under a 300 s `timeout`, with a KILL 10 s later, in four parallel lanes, and the whole bake has a budget of ⌈fixtures / 4⌉ × 310 s + 30 s. The guest's `timeout` is busybox, which exits with the killed command's status (143 or 137) rather than GNU's 124, so the script decides "ran over" from elapsed time. Each e2e leg's step summary reports the bake (`BAKE_HIT`, `BAKE_PARTIAL` or `BAKE_FULL`, with each lock's digest); a failed bake names its reason there and in a `::error` annotation:

| Code                       | Meaning                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_BAKE_STALLED`         | An `npm ci` ran past its deadline. Names the fixture and the deadline.                                                                              |
| `E2E_BAKE_TARBALL_MISSING` | A lock names a closure tarball the harness did not pack. Names the tarball.                                                                         |
| `E2E_BAKE_FAILED`          | `npm ci` failed for another reason. Names the fixture and npm's first error line.                                                                   |
| `E2E_BAKE_OVER_BUDGET`     | The whole bake ran past its budget. Names the phase it was in: pulling the guest image and booting the microVM, or installing (with the boot time). |
| `E2E_BAKE_ARGV`            | The harness called the bake script with the wrong arguments.                                                                                        |
| `E2E_SETUP_FAILED`         | Global setup failed before the bake finished.                                                                                                       |
| `E2E_BAKE_NO_RECORD`       | Global setup wrote no bake record, so the leg reports no bake state.                                                                                |

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

The lane runs the packed `dist/main.mjs`, not workspace source. A worker failure that cannot be reproduced from source is a bundle defect (an unresolvable import, or a tree-shaken combinator compiling to `(void 0)`): read the packed-bundle line in the stack before blaming source. The image uses a fixed tag, so a run may adopt bundles baked before your edit — after changing a workspace package, clear the baked cache (`rm -rf node_modules/.cache/stryker-e2e/baked`) before trusting a verdict.
