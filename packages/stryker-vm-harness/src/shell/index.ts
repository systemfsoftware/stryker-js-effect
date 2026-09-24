export {
  type EffectVitestSurface,
  readGlobalState,
  readGlobalStateCell,
  type VmRunnerGlobalState,
  writeGlobalState,
  writeGlobalStateCell,
} from './global-state.js'

export {
  activateSandbox,
  activateSandboxCell,
  type ActivateSandboxCommand,
  deactivateSandbox,
  deactivateSandboxCell,
  HARNESS_URLS,
  type HarnessModuleBuiltin,
  installInterception,
  installInterceptionCell,
  type InterceptionRuntime,
  type RegisterHooksFn,
  resetInterceptionForTests,
  uninstallInterception,
  uninstallInterceptionCell,
} from './interception.js'

export { nativeImport } from './native-import.js'

export { executeDrainRegistry } from './drain-executor.js'
export type { DrainRunOptions, DrainTestOutcome, DrainTestRef } from './drain-executor.js'

export {
  type EachBinder,
  type EachFn,
  type EffectAdapterRegistration,
  type EffectTester,
  type EffectTesterVariants,
  type EffectTestFunction,
  type EffectTestOptions,
  type EffectVitestIt,
  type LayerBinder,
  layerBinderFor,
  type LayeredVitestIt,
  type LayerRegistrationContext,
  makeEffectMethods,
  type PropBinder,
} from './effect-adapter.js'

export { definePlugin } from './plugins/define.js'
export { environmentPlugin } from './plugins/environment.js'
export { globalsPlugin } from './plugins/globals.js'
export { builtinPlugins } from './plugins/index.js'
export { createMockingPlugin } from './plugins/mocking.js'
export { runnerStatePlugin } from './plugins/runner-state.js'
export { setupFilesPlugin } from './plugins/setup-files.js'
export { createVmSession, type VmSession } from './session.js'

export { snapshotsPlugin } from './plugins/snapshots.js'

export {
  createSnapshotEnvironment,
  createSnapshotSupport,
  ensureVitestWorkerState,
  setWorkerTestFile,
  type SnapshotClientLike,
  snapshotClientOf,
  type SnapshotEnvironmentLike,
  type SnapshotEnvironmentOptions,
  type SnapshotStackFrame,
  type SnapshotStateOptionsLike,
  type SnapshotSummaryLike,
  type SnapshotSupport,
} from './snapshots/index.js'

export {
  runLoadStage,
  runResolveStage,
  runStage,
  type VitestModuleNamespace,
  VM_TEST_FILES_BAG_KEY,
  type VmDiscoveredTestFiles,
  type VmFileContext,
  type VmGlobalsStage,
  type VmGraphContext,
  type VmLoadStage,
  type VmPluginBag,
  type VmPluginHost,
  type VmResolveStage,
  type VmRunContext,
  type VmSessionPlugin,
  type VmStageArgs,
  type VmStageName,
  type VmTestContext,
  type VmTestOutcome,
} from './session-plugin.js'

export { createVmWorkerClient, type VmWorkerClient, type VmWorkerClientHooks } from './worker-client.js'

export {
  armMutant,
  hostStrykerNamespace,
  readArmedMutant,
  readMutantCoverage,
  resetMutantCoverage,
  setCurrentTestId,
  type StrykerNamespace,
  writeArmedMutant,
} from './stryker-namespace.js'
