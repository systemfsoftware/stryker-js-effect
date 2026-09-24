import { Metamorphic } from '@systemfsoftware/differential-spec'
import { Effect } from 'effect'

import { planSeeds } from './__fixtures__/arbitraries.js'
import { planRelation, planRowsOf, type PlanSeedSpec } from './__fixtures__/differential-oracle.js'

Metamorphic.on((seed: PlanSeedSpec) => Effect.promise(() => planRowsOf(seed)))
  .relation({
    transformInput: (seed: PlanSeedSpec): PlanSeedSpec => ({ ...seed, prepared: true }),
    assertOutput: (baseline, followUp) => planRelation(baseline, followUp),
  })
  .on(planSeeds, { runBudget: 200 })
