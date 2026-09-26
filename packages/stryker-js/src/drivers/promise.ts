import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'

import type { MutationTestDone } from '../run/mutation-test.cell.js'
import { strykerCell } from '../run/run-stages.cell.js'
import { nodePlatformLayer } from './node.js'

export const run = dual<
  (
    targetMutatePatterns?: readonly string[],
  ) => (options: Options.PartialStrykerOptions) => Promise<MutationTestDone>,
  (options: Options.PartialStrykerOptions, targetMutatePatterns?: readonly string[]) => Promise<MutationTestDone>
>(
  (args) => args.length === 2 || Array.isArray(args[0]) === false,
  (options, targetMutatePatterns) =>
    Effect.runPromise(strykerCell(options, targetMutatePatterns).pipe(Effect.provide(nodePlatformLayer))),
)
