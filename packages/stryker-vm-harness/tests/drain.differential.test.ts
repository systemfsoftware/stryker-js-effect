import { Metamorphic } from '@systemfsoftware/differential-spec'
import { Effect } from 'effect'

import { drainSeeds } from './__fixtures__/arbitraries.js'
import { drainedRows, drainRelation, type DrainSeedSpec, drainTransform } from './__fixtures__/differential-oracle.js'

const HOST_BOUND = {
  timeout: 60_000,
  reason: 'the drain runs the registered bodies on real setImmediate callbacks under its own real 5000 ms wall clock',
} as const

Metamorphic.on({
  name: 'drained rows agree across the drain transform',
  system: (seed: DrainSeedSpec) => Effect.promise(() => drainedRows(seed)),
})
  .relation({
    transformInput: (seed: DrainSeedSpec): DrainSeedSpec => drainTransform(seed),
    assertOutput: (baseline, followUp) => drainRelation(baseline, followUp),
  })
  .on(drainSeeds, { runBudget: 200, hostBound: HOST_BOUND })
