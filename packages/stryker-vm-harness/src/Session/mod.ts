export { definePlugin } from '../plugins/define.js'
export { environmentPlugin } from '../plugins/environment.js'
export { globalsPlugin } from '../plugins/globals.js'
export { builtinPlugins } from '../plugins/index.js'
export { createMockingPlugin } from '../plugins/mocking.js'
export { runnerStatePlugin } from '../plugins/runner-state.js'
export { setupFilesPlugin } from '../plugins/setup-files.js'
export { snapshotsPlugin } from '../plugins/snapshots.js'
export { transformPlugin } from '../plugins/transform.js'
export { createVitestConfigPlugin, vitestConfigPlugin } from '../plugins/vitest-config.js'
export {
  runLoadStage,
  runResolveStage,
  runStage,
  type VitestModuleNamespace,
  VM_TEST_FILES_BAG_KEY,
  type VmDiscoveredTestFiles,
  type VmFileContext,
  type VmGlobals,
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
} from '../session-plugin.js'
export { createVmSession, type VmSession } from '../session.js'
export {
  defaultSnapshotPath,
  SNAPSHOT_DIRECTORY,
  SNAPSHOT_SUFFIX,
  type SnapshotUpdateMode,
  snapshotUpdateMode,
} from '../snapshot-paths.js'
export {
  currentSnapshotTest,
  setSnapshotTest,
  type SnapshotTask,
  snapshotTaskOf,
  type SnapshotTest,
} from '../snapshot-test.js'
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
} from '../snapshots/index.js'
export {
  armMutant,
  hostStrykerNamespace,
  readArmedMutant,
  readMutantCoverage,
  resetMutantCoverage,
  setCurrentTestId,
  type StrykerNamespace,
  writeArmedMutant,
} from '../stryker-namespace.js'
export {
  type VmAlias,
  type VmAliasFind,
  VmAliasFindSchema,
  VmAliasSchema,
  type VmExpectConfig,
  VmExpectConfigSchema,
  VmProjectConfigSchema,
  type VmTagDefinition,
  VmTagDefinitionSchema,
  VmVitestConfigSchema,
} from '../vitest-config.schema.js'
export { createVmVitestRuntime, type VmVitestBridgeOptions, type VmVitestHostHandle } from '../vitest-host/bridge.js'
export {
  VM_VITEST_BAG_KEY,
  type VmProjectConfig,
  type VmTransformResult,
  type VmVitestConfig,
  type VmVitestRuntime,
} from '../vitest-host/runtime.js'
export {
  type VmMutantCoverage,
  VmMutantCoverageSchema,
  type VmRunKind,
  VmRunKindSchema,
  type VmRunRequest,
  VmRunRequestSchema,
  type VmRunResponse,
  VmRunResponseSchema,
  type VmSessionOptions,
  VmSessionOptionsSchema,
  type VmTestResult,
  VmTestResultSchema,
  type VmTestStatus,
  VmTestStatusSchema,
  type VmWorkerRequest,
  VmWorkerRequestSchema,
  type VmWorkerResponse,
  VmWorkerResponseSchema,
} from '../vm-protocol.schema.js'
export { createVmWorkerClient, type VmWorkerClient, type VmWorkerClientHooks } from '../worker-client.js'
