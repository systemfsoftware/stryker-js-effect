import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Effect from 'effect/Effect'
import type { StageError } from './Run.schema.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'

export type StrykerRun = (
  options: PartialStrykerOptions,
  targetMutatePatterns?: string[],
) => Effect.Effect<MutationTestDone, StageError, never>
