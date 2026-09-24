## 2.0.0

### Major Changes

- Its main entry point now groups exports into capability namespaces instead of one flat set.

  - `Registry`: `createRegistry`, `createHarnessApi`, `formatEachName`.
  - `Drain`: `drainRegistry`, `pureDrainRegistry`, `DrainCompleted`, `DrainTimedOut`, `DrainOutcome`, `DrainedStatus`, `DrainedTest`, `DrainedTestSchema`, `TestOutcome`, `TestOutcomeSchema`, `DrainRegistryCommand`.
  - `Assertions`: `guardedExpect`, `guardedVi`. `EffectAdapter`: `makeEffectMethods`.
  - `Sandbox`: `activateSandbox`, `deactivateSandbox`, `installInterception`, `uninstallInterception`, `readGlobalState`, `writeGlobalState`, `nativeImport`, `harnessSourceFor`, `harnessUrlForSpecifier`, plus the `HarnessModuleBuiltin` and `VmRunnerGlobalState` types.

  Import the namespace and qualify each name, for example `Registry.createRegistry()`.
