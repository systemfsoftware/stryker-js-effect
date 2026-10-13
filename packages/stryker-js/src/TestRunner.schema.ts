import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import type { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'

export type PooledTestRunnerError =
  | TestRunner.TestRunnerFailed
  | ChildProcessCrashedError
  | OutOfMemoryError

export const WorkerNeverStartedReason = S.Literal('worker-never-started')
