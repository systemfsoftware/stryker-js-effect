import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import { nodePlatformLayer } from '../drivers/node.js'
import { strykerCell } from '../mod.js'
import type { MutationTestDone } from '../run/mutation-test.cell.js'

export const run = dual<
  (
    targetMutatePatterns?: readonly string[],
  ) => (options: PartialStrykerOptions) => Promise<MutationTestDone>,
  (options: PartialStrykerOptions, targetMutatePatterns?: readonly string[]) => Promise<MutationTestDone>
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
