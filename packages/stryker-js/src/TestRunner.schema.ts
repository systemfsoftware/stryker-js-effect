import type { TestRunnerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'

export type PooledTestRunnerError =
  | TestRunnerFailed
  | ChildProcessCrashedError
  | OutOfMemoryError