## 3.0.0

### Major Changes

- Vitest 4 is no longer supported: the `vitest` peer dependency is now `^5`. Upgrade your project to Vitest 5 before upgrading these packages.

### Minor Changes

- `Assertions.dispatchingExpect(real, createExpect)` wraps Vitest's global `expect` so each call uses the `expect` that `createExpect` builds for the running test. That per-test `expect` is what `expect.soft`, `expect.poll`, and `.resolves` need. The function also works data-last: `dispatchingExpect(createExpect)(real)`. `Assertions.guardedExpect(real)` behaves as before.

- `@systemfsoftware/stryker-vm-harness` now exports the session a run is driven through, not only the sandbox primitives. Under the `Session` namespace, `Session.createVmSession` and `Session.createVmWorkerClient` speak the plain-data `Session.VmRunRequest`/`Session.VmRunResponse` contract, `Session.builtinPlugins` exposes the Vitest feature plugins individually, and the snapshot and Vitest-host runtimes are available behind them. Two subpath entries are added: `@systemfsoftware/stryker-vm-harness/worker`, which runs a session inside a worker thread, and `@systemfsoftware/stryker-vm-harness/vitest-host-worker`, which backs Vitest config and transform resolution.

### Patch Changes

- A project reached through a symbolic link now runs in the in-memory runner. Before this fix, every test file in such a directory failed to load; on macOS that includes projects under `/tmp`, which links to `/private/tmp`. The runner now resolves the working directory and each test file to its real path before loading.

- The vm runner now runs far less work per mutant. Its dry run records per-test mutant coverage, so a mutant run executes only the tests that cover it instead of the whole suite; a run that reaches the configured test hit limit stops there, and a mutant run that does not reload the environment reuses the already-loaded module graph. A module with present-but-empty coverage no longer falls back to running every test, and each test-runner instance runs tests in its own worker thread instead of queueing behind one shared lock, so independent runs overlap.
