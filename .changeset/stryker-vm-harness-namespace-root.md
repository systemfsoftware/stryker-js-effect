---
"@systemfsoftware/stryker-vm-harness": major
---

Its main entry point now groups exports into capability namespaces instead of one flat set.

- `Registry`: `createRegistry`, `createHarnessApi`, `formatEachName`.
- `Drain`: `drainRegistry`, `pureDrainRegistry`, `DrainCompleted`, `DrainTimedOut`, `DrainOutcome`, `DrainedStatus`, `DrainedTest`, `DrainedTestSchema`, `TestOutcome`, `TestOutcomeSchema`, `DrainRegistryCommand`.
- `Assertions`: `guardedExpect`, `guardedVi`. `EffectAdapter`: `makeEffectMethods`.
- `Sandbox`: `activateSandbox`, `deactivateSandbox`, `installInterception`, `uninstallInterception`, `readGlobalState`, `writeGlobalState`, `nativeImport`, `harnessSourceFor`, `harnessUrlForSpecifier`, plus the `HarnessModuleBuiltin` and `VmRunnerGlobalState` types.
- `Session`: `createVmSession`, `createVmWorkerClient`, `builtinPlugins`, the Vitest feature plugins (`definePlugin`, `environmentPlugin`, `globalsPlugin`, `setupFilesPlugin`, `createMockingPlugin`, `runnerStatePlugin`, `snapshotsPlugin`, `transformPlugin`, `vitestConfigPlugin`), and the `VmRunRequest`/`VmRunResponse`/`VmSessionOptions` run contract.

Import the namespace and qualify each name, for example `Registry.createRegistry()`.
