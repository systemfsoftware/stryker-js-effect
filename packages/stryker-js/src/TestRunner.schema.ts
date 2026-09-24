import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'

export type PooledTestRunnerError =
  | TestRunner.TestRunnerFailed
  | ChildProcessCrashedError
  | OutOfMemoryError
