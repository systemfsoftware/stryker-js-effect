import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import type * as Effect from 'effect/Effect'
import type * as Queue from 'effect/Queue'

import type { RunEvent } from '../run-event.schema.js'
import type { StageError } from '../Run.schema.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'

export interface HostServices {
  readonly env: RunEnvironmentShape
  readonly events: Queue.Queue<RunEvent, Cause.Done>
}

export type StrykerRun = (
  options: PartialStrykerOptions,
  targetMutatePatterns?: string[],
) => Effect.Effect<MutationTestDone, StageError, never>
