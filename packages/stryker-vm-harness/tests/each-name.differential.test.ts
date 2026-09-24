import { Differential, Metamorphic } from '@systemfsoftware/differential-spec'
import { formatEachName } from '@systemfsoftware/stryker-vm-harness'
import { Effect } from 'effect'

import { eachNameSpecs } from './__fixtures__/arbitraries.js'
import { type EachNameSpec, formatEachNameReference } from './__fixtures__/differential-oracle.js'

const referenceNameOf = (spec: EachNameSpec): Effect.Effect<string> => Effect.sync(() => formatEachNameReference(spec))

const candidateNameOf = (spec: EachNameSpec): Effect.Effect<string> =>
  Effect.sync(() => formatEachName(spec.template, spec.row))

Differential.compare({ reference: referenceNameOf, candidate: candidateNameOf })
  .on(eachNameSpecs, { runBudget: 200 })
  .assert((referenceName, candidateName) => referenceName === candidateName)

const withTailTitle = (spec: EachNameSpec): EachNameSpec => ({
  template: `${spec.template} Tail`,
  row: spec.row,
})

Metamorphic.on(candidateNameOf)
  .relation({
    transformInput: withTailTitle,
    assertOutput: (baseline: string, followUp: string): boolean => followUp === `${baseline} Tail`,
  })
  .on(eachNameSpecs, { runBudget: 200 })
