# AGENTS.md — `@systemfsoftware/stryker-js-cli-e2e`

Private E2E lane for the shipped `stryker` artifact: it packs the five workspace
packages fresh, installs the CLI tarball into one digest-pinned `node:24-alpine`
container, and asserts the published contract. Publishes no artifact. Parent:
`apps/AGENTS.md`.

## Run

```bash
DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}') TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm test:e2e
```

## Rules

| ID        | Rule                                                                                                                                                                                                                           | Gate                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **E2E-1** | This app MUST NOT declare a `test` script: the lane runs only as its own `test:e2e` turbo task (`cache: false`), which is what keeps container-dependent tests out of `pnpm test`, `pnpm check:ci`, and the macOS CI matrix.   | `review` — `package.json` declares `test:e2e`, never `test`                     |
| **E2E-2** | Fixture oracles in `testResources/*/oracle.md` are hand-authored: a run may confirm the numbers, never originate them. A mismatch is triaged as a fixture-authoring error or a product bug, never auto-copied into the oracle. | `review` — every expected count traces to an `oracle.md` derivation (CONST-T10) |
| **E2E-3** | The lane imports no workspace package: assertions decode the machine stream's plain JSON events against the authored expectations, keeping the oracle independent of the system under test.                                    | `review` — no workspace-package import under `tests/` or `testResources/`       |
| **E2E-4** | Fixtures name their runner plugin (`"plugins": ["@systemfsoftware/stryker-js-vitest-runner"]`); they never rely on the default plugin glob, which under a global CLI install sees only the CLI's own install root.             | `review` — every `testResources/*/stryker.config.json` declares `plugins`       |

## Lint scope

`oxlint.config.ts` sets oxlint's correctness category plus the strict trio every
package here sets. It deliberately does not extend `@systemfsoftware/all`: that
preset encodes the layers this app sits _below_ (suffix and shape rules for
`src/` workflow and property tests, the Gherkin requirement for behaviour files),
and none of them describe a lane that drives a packed artifact through a
container. `tests/__fixtures__/` is the repo's home for non-test helper modules
under `tests/`.

## Machine stream

The CLI writes its machine-mode events to `reports/mutation-stream.jsonl` under
the run's working directory, not to stdout
(`packages/stryker-js-language/src/Schema.schema.ts`, default;
`apps/stryker-js-cli/src/StreamFile.ts`). Journeys read that file with
`runShell` and fail loudly when it is absent.

## Container environment

Read by testcontainers; the `test:e2e` turbo task passes them through.

| Variable                         | Value                                                          | Why                                                                                        |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DOCKER_HOST`                    | `unix://$(podman info --format '{{.Host.RemoteSocket.Path}}')` | Point testcontainers at the podman socket; leave unset under Docker.                       |
| `TESTCONTAINERS_RYUK_PRIVILEGED` | `true`                                                         | Rootful podman — Ryuk needs privilege to mount the root-owned socket.                      |
| `TESTCONTAINERS_RYUK_DISABLED`   | `true`                                                         | Rootless podman — Ryuk cannot run; the suite still stops its container in `afterAll`.      |
| `TESTCONTAINERS_HOST_OVERRIDE`   | host or IP                                                     | The hostname a container uses to reach the Docker host (remote daemon or CI-in-container). |
