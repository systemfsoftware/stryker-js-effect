import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import { nodePlatformLayer } from '../drivers/node.js'
import type { MutationTestDone } from '../run/mutation-test.cell.js'
import { strykerCell } from '../run/run-stages.cell.js'

export const run = dual<
  (
    targetMutatePatterns?: readonly string[],
  ) => (options: Options.PartialStrykerOptions) => Promise<MutationTestDone>,
  (options: Options.PartialStrykerOptions, targetMutatePatterns?: readonly string[]) => Promise<MutationTestDone>
>(
  (args) => args.length === 2 || Array.isArray(args[0]) === false,
  (options, targetMutatePatterns) => {
    const runtime = ManagedRuntime.make(nodePlatformLayer)
    return runtime.runPromise(strykerCell(options, targetMutatePatterns)).then(
      (done) => runtime.dispose().then(() => done),
      (cause) => runtime.dispose().then(() => Promise.reject(cause)),
    )
  },
)
