---
"@systemfsoftware/stryker-vm-harness": minor
---

`@systemfsoftware/stryker-vm-harness` now exports the session a run is driven through, not only the sandbox primitives: `createVmSession` and `createVmWorkerClient` speak the plain-data `VmRunRequest`/`VmRunResponse` contract, `builtinPlugins` exposes the Vitest feature plugins individually (`definePlugin`, `environmentPlugin`, `globalsPlugin`, `setupFilesPlugin`, `createMockingPlugin`, `snapshotsPlugin`, `transformPlugin`, `vitestConfigPlugin`), and the snapshot and Vitest-host runtimes are available behind them. Two subpath entries are added: `@systemfsoftware/stryker-vm-harness/worker`, which runs a session inside a worker thread, and `@systemfsoftware/stryker-vm-harness/vitest-host-worker`, which backs Vitest config and transform resolution.
