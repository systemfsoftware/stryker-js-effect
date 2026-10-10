import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import type * as Effect from 'effect/Effect'
import type * as Queue from 'effect/Queue'

export interface HostServices {
  readonly env: Run.RunEnvironmentShape
  readonly events: Queue.Queue<RunEvent.RunEvent, Cause.Done>
}

export type StrykerRun = (
  options: Options.PartialStrykerOptions,
  targetMutatePatterns?: string[],
) => Effect.Effect<Reports.MutationTestDone, Run.StageError, never>
