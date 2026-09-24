import { Metamorphic } from '@systemfsoftware/differential-spec'
import { Effect } from 'effect'

import { drainSeeds } from './__fixtures__/arbitraries.js'
import { drainedRows, drainRelation, type DrainSeedSpec, drainTransform } from './__fixtures__/differential-oracle.js'

Metamorphic.on((seed: DrainSeedSpec) => Effect.promise(() => drainedRows(seed)))
  .relation({
    transformInput: (seed: DrainSeedSpec): DrainSeedSpec => drainTransform(seed),
    assertOutput: (baseline, followUp) => drainRelation(baseline, followUp),
  })
  .on(drainSeeds, { runBudget: 200 })
