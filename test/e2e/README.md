# `@systemfsoftware/stryker-e2e`

MicroVM-isolated end-to-end tests for the packaged `@systemfsoftware/stryker-js` binary and its plugins.

## What it tests

The suite resolves the workspace closure of the CLI and its plugins, packs each member with `pnpm pack`, installs the whole closure into isolated fixture projects inside a preparation microVM, and runs every `stryker` invocation in its own [`@systemfsoftware/effect-microsandbox`](https://www.npmjs.com/package/@systemfsoftware/effect-microsandbox) microVM to verify behavior across the process boundary:

- Full mutation runs against realistic test suites
- Exit codes and typed machine-mode JSON error envelopes on failure

The closure installs in one `npm install` with no `@systemfsoftware` workspace package taken from the registry. `pnpm pack` rewrites a workspace alias (`"@systemfsoftware/stryker-js-vm-runner": "workspace:@systemfsoftware/stryker-js-vitest-runner@^"`) to `npm:<target>@^<version>`, and npm resolves an `npm:` spec from the registry even when the target's tarball is in the same install. So the install passes every packed tarball plus one `<alias>@file:<target tarball>` spec per alias edge between closure members (`installClosure` in `@systemfsoftware/stryker-e2e-core`). Global setup fails, naming the edge, instead of reaching the registry when a packed member depends on a workspace package the closure did not pack (`UnpackedWorkspaceDependency`), when one alias name would install two different packages (`ConflictingAliasTargets`), or when a fixture manifest names a workspace package itself (`FixtureNamesWorkspacePackage`). The closure is installed into every fixture, so a fixture never names it.

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

Global setup keys the prepared fixtures on two inputs: the packed closure (base image, `test/e2e-core/bake/bake-fixtures.sh`, the registry cutoff, and the unpacked contents of every packed tarball) and, separately, each fixture's own source files with its manifests resolved against the catalogs in the repo-root `pnpm-workspace.yaml`. The cache holds `node_modules/.cache/stryker-e2e/baked/<packs-key>/<fixtureId>.<fixture-key>`, so editing one fixture re-bakes that fixture alone; editing a workspace package or a catalog entry lands a new closure key and re-bakes its fixture set, with no manual invalidation.

A run leases its entry for as long as it lives and prunes unleased entries of other keys from its global teardown, so concurrent runs sharing the cache do not delete each other's entries.

In CI every e2e leg restores the newest `e2e-bake-<os>-` cache entry its ref can read, before the lane. A leg whose packs key matches skips the bake; any other restored root is pruned at teardown. When the `lifecycle` leg baked a fixture, it drops fixture entries the run did not use and saves the root as `e2e-bake-<os>-<packs-key>-<fixture-set digest>`, on main pushes and in the pull request's own scope, so an unchanged bake is uploaded once. The bake installs the fixtures in four concurrent lanes, registry dependencies before workspace tarballs within each fixture.

### Registry snapshot

The bake never resolves against the live registry. Every `npm install` in the bake runs with `--before=<REGISTRY_CUTOFF>` (`test/e2e-core/src/registry-pins.ts`), and every staged fixture manifest pins the `effect` and `@effect/*` packages to the exact versions the root `pnpm-lock.yaml` resolves, as direct specs and, in the fixture's root manifest, as `overrides` that reach the packed closure's transitive dependencies. A release published after the cutoff therefore cannot change a fixture or stall the bake. The cutoff is the commit time of the root lockfile; move it to the new lockfile commit time when a lockfile change needs a newer registry release in the fixtures.

Each install in the bake has a 60-second deadline (`BAKE_INSTALL_DEADLINE_SECONDS` in `test/e2e-core/src/bake-budget.ts`, killed 10 seconds after `TERM`). The whole bake has a budget derived from the same constants, enough for the busiest lane to run every install to its deadline plus boot time: 310 seconds for seven fixtures. A failing bake therefore ends the leg well inside its step timeout. Global setup writes a bake record when `STRYKER_E2E_BAKE_RECORD` names a file, and the CI step `Bake report` publishes it as the leg's step summary and one `::error` annotation per reason:

| Reason code             | Raised when                                                                                                 | Next action in the annotation                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `E2E_BAKE_ARGV`         | `bake-fixtures.sh` was called without its `--before`, `--root`, `--deadline` and `--lanes` options in order | call it as the harness's `bakeMissing` does                                         |
| `E2E_BAKE_STALLED`      | one install did not finish within its deadline (the detail names its exit)                                  | re-run if the registry was slow; otherwise resolve the staged manifest on the host  |
| `E2E_BAKE_CUTOFF_STALE` | npm found no version of a spec published before the cutoff                                                  | move `REGISTRY_CUTOFF` to the `pnpm-lock.yaml` commit time                          |
| `E2E_BAKE_OVER_BUDGET`  | the whole bake ran past its budget                                                                          | re-run; otherwise compare the `e2e.setup.bake` span with the last green run         |
| `E2E_BAKE_FAILED`       | the bake exited non-zero without naming a reason                                                            | read the npm output in the global setup error                                       |
| `E2E_SETUP_FAILED`      | global setup failed before or around the bake for another cause                                             | read the global setup error                                                         |
| `E2E_BAKE_NO_RECORD`    | the lane step ended without a record: an error when it failed, a warning when it passed (CI step only)      | read the global setup error, or check that `STRYKER_E2E_BAKE_RECORD` reaches Vitest |

A green bake's summary names its state (`BAKE_HIT`, `BAKE_PARTIAL`, `BAKE_FULL`), the fixture counts, the packs key, the restored cache entry and each fixture's `package-lock.json` digest.

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
