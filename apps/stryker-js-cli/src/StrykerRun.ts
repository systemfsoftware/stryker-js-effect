import type { MutationTestDone, StageError } from '@systemfsoftware/stryker-js-engine'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-language'
import type * as Effect from 'effect/Effect'

export type StrykerRun = (
  options: PartialStrykerOptions,
  targetMutatePatterns?: string[],
) => Effect.Effect<MutationTestDone, StageError, never>
