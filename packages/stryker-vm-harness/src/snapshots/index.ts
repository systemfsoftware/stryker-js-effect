export type {
  SnapshotClientLike,
  SnapshotEnvironmentLike,
  SnapshotStackFrame,
  SnapshotStateOptionsLike,
  SnapshotSummaryLike,
} from './snapshot-api.js'
export { ensureVitestWorkerState, setWorkerTestFile, snapshotClientOf } from './snapshot-api.js'
export { createSnapshotEnvironment, type SnapshotEnvironmentOptions } from './snapshot-environment.js'
export {
  createSnapshotSupport,
  setSnapshotDrainWindow,
  setSnapshotRegistry,
  type SnapshotSupport,
} from './snapshot-support.js'
