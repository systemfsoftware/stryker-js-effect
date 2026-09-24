## 11.0.0

### Major Changes

- The in-process `vm` runner is now the default `testRunner`. With no `testRunner` and no `testFiles` configured, the vm runner asks Vitest which files are tests. It runs exactly the files `vitest run` would, including your config's `include`, `exclude`, and `includeSource`, or Vitest's defaults when there is no config file. A run that loads no test files, or whose initial run registers zero tests, now fails the dry run with an error naming the `vm` runner and pointing at `testFiles`, instead of reporting a successful run where every mutant survives. Projects that relied on the previous default shelling out to a test command must set `testRunner: 'command'` (or `'vitest'`) to keep that behaviour.

- The `VmRunner`, `VmPlatform`, and `VmFileUrl` exports are removed from the `Plugin` namespace of `@systemfsoftware/stryker-js`, and `VmTestRunnerConfig.sandboxWorkingDirectory` is now required rather than optional. Code that imported the removed names, or that built a vm runner config without a working directory, must drop those imports and pass `sandboxWorkingDirectory`.

  `Plugin.vmTestRunner` no longer needs a `VmRunner` service. It needs a `Scope` instead, and closing that scope stops the runner's worker thread. Call it inside `Effect.scoped`, or inside another scope that ends when the run ends.

### Minor Changes

- Projects using `@systemfsoftware/stryker-js` as a CLI tool no longer receive warnings or automatic installs for `effect`. The peer dependency is now optional, required only when importing programmatic APIs from the package.

  `@systemfsoftware/stryker-js-vitest-runner` and `@systemfsoftware/stryker-test-contribution` no longer declare a peer dependency on `effect`.

- The vm runner now runs Vitest suites that use module mocking (`vi.mock`, `vi.doMock`, automocking, spies), snapshot assertions with update modes and custom snapshot paths, test environments (`node`, `jsdom`, `happy-dom`), setup files, `globals` and `define`, `provide`/`inject`, in-source tests, and a project's own Vitest config — `include`, `exclude`, `alias`, `projects`, `isolate`, timeouts, mock-reset and fake-timer options, JSX/TSX and other custom transforms, and `import.meta.env`. Suites that need Vitest browser mode still fail with an error naming `testRunner: 'vitest'`.

  As under `vitest run`, a discovered test file that registers no tests fails with `No test suite found in file <path>`, so a mutant that removes every test from an in-source test block is killed rather than surviving.

### Patch Changes

- The vm runner now runs far less work per mutant. Its dry run records per-test mutant coverage, so a mutant run executes only the tests that cover it instead of the whole suite; a run that reaches the configured test hit limit stops there, and a mutant run that does not reload the environment reuses the already-loaded module graph. A module with present-but-empty coverage no longer falls back to running every test, and each test-runner instance runs tests in its own worker thread instead of queueing behind one shared lock, so independent runs overlap.

- Updated dependencies:
  - @systemfsoftware/stryker-vm-harness@3.0.0
