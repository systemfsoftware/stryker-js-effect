import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import { strykerCell } from '../run/run-stages.js'
import { platformLayer } from './platform.js'

export const run = dual<
  (
    targetMutatePatterns?: readonly string[],
  ) => (options: Options.PartialStrykerOptions) => Promise<Reports.MutationTestDone>,
  (
    options: Options.PartialStrykerOptions,
    targetMutatePatterns?: readonly string[],
  ) => Promise<Reports.MutationTestDone>
>(
  (args) => args.length === 2 || Array.isArray(args[0]) === false,
  (options, targetMutatePatterns) =>
    Effect.runPromise(strykerCell(options, targetMutatePatterns).pipe(Effect.provide(platformLayer))),
)
