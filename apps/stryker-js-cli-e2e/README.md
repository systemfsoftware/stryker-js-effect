# `@systemfsoftware/stryker-js-cli-e2e`

Private end-to-end lane for the shipped `stryker` artifact. It exists for the
three behaviors observable solely at the end-to-end seam — a broken packed
install, a dead bin, and a lost machine-mode envelope at the process boundary.
Everything below that seam (flag permutations, error taxonomy, mode resolution,
`merge-reports`) is pinned by the CLI's property suites and the engine's
integration tests and is not re-tested here.

| Journey        | Test                               | Behavior it owns                                                                                                                         |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Packed install | `tests/packed-install.e2e.test.ts` | A freshly packed tarball installs the way a consumer installs it, and the installed `stryker` bin runs.                                  |
| Mutation run   | `tests/mutation-run.e2e.test.ts`   | One real run through the packed runner plugin and the sandbox worker ends in a machine-mode `verdict` matching the hand-authored oracle. |
| Failing run    | `tests/failing-run.e2e.test.ts`    | A failing dry run crosses the boundary as the typed machine-mode `error` document with its classed exit code.                            |

Every run packs five workspace packages (`stryker-js-cli`,
`stryker-js-vitest-runner`, `stryker-js-language`, `stryker-js-plugin-interface`,
`stryker-ignorer-interface`) fresh with `pnpm pack` into a temp directory, starts
**one** digest-pinned `node:24-alpine` container through testcontainers, installs
the CLI tarball with `npm install -g`, installs the fixture projects, and asserts
exit codes, the machine-mode event stream, and typed error documents — each
against a hand-authored oracle. No tarball, container state, or run output is
committed.

## What the lane learned about the artifact

Reading the product, not assuming it:

- **The machine-mode stream is a file, not stdout.** `progressStreamFile`
  defaults to `reports/mutation-stream.jsonl` relative to the run's working
  directory (`packages/stryker-js-language/src/Schema.schema.ts`,
  `apps/stryker-js-cli/src/StreamFile.ts`). Stdout stays empty. The lane reads
  that file; a missing file fails the journey loudly rather than looking like an
  empty stream.
- **The verdict carries only the actionable mutants.** `counts` is complete
  (this fixture: 7 killed, 2 survived, 9 total), while the `mutants` array holds
  the `Survived`/`NoCoverage`/`Timeout`/`RuntimeError` subset
  (`packages/stryker-js-engine/src/verdict-envelope.ts`). The lane asserts the
  whole set from the `mutant` events and the actionable subset from the verdict.
- **A globally installed CLI cannot discover project-local plugins by glob.**
  The glob form is expanded by walking upward from the engine module's own
  location (`packages/stryker-js-engine/src/Plugins.ts`, `readOrgDirectory`), so
  under `npm install -g` the only visible plugin is the CLI itself: a fixture
  whose config relies on the default `@systemfsoftware/stryker-js-*` glob gets
  `PluginNotFoundError` from the test-runner worker and the run then **hangs**
  with no terminal event and no exit. The fixtures therefore name the runner
  (`"plugins": ["@systemfsoftware/stryker-js-vitest-runner"]`), which resolves
  from the project. Recorded here because it is a product finding, not a lane
  preference.
- **A failing dry run is `RuntimeError`.** Exit code 3, terminal `error` event
  with a non-empty `remediation`; the exit-code table sits below.

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
| `tests/__fixtures__/bed.ts` | The host-side bed: packs the workspace, starts one container, installs the tarballs, reads the stream file back.       |
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

## CI

The lane stays out of `pnpm test` and `pnpm check:ci` by design (the app declares
no `test` script), so it needs its own job; the owner applies the job below to
`.github/workflows/ci.yml`:

```yaml
e2e:
  runs-on: ubuntu-latest
  timeout-minutes: 45
  steps:
    - uses: actions/checkout@v7
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v7
      with:
        node-version: 24
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm test:e2e
```
