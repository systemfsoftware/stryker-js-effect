import { Metamorphic } from '@systemfsoftware/differential-spec'
import { Effect } from 'effect'

import { planSeeds } from './__fixtures__/arbitraries.js'
import { planRelation, planRowsOf, type PlanSeedSpec } from './__fixtures__/differential-oracle.js'

const HOST_BOUND = {
  timeout: 60_000,
  reason: 'the drain runs the planned bodies on real setImmediate callbacks under its own real 5000 ms wall clock',
} as const

Metamorphic.on({
  name: 'planned rows agree across the prepared transform',
  system: (seed: PlanSeedSpec) => Effect.promise(() => planRowsOf(seed)),
})
  .relation({
    transformInput: (seed: PlanSeedSpec): PlanSeedSpec => ({ ...seed, prepared: true }),
    assertOutput: (baseline, followUp) => planRelation(baseline, followUp),
  })
  .on(planSeeds, { runBudget: 200, hostBound: HOST_BOUND })
