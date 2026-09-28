import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { staticVerdictOf } from '../reporting/static-verdict.js'

const runResultsArb = Arbitrary.array(Arbitrary.schema(Mutant.Mutant), { maxLength: 6 }).pipe(
  Arbitrary.map((mutants) =>
    mutants.map(
      (mutant, index): Mutant.RunMutantResult => ({
        ...mutant,
        status: 'Killed',
        static: index % 2 === 0,
        cost: { fixedOverheadMs: index, testBodyMs: index * 2, testsExecuted: 1, shared: false },
      }),
    )
  ),
)

const staticResultsOf = (results: readonly Mutant.RunMutantResult[]): readonly Mutant.RunMutantResult[] =>
  Arr.filter(results, (result) => result.static === true)

const costTotalOf = (result: Mutant.RunMutantResult): number =>
  result.cost === undefined ? 0 : result.cost.fixedOverheadMs + result.cost.testBodyMs

describe('staticVerdictOf', () => {
  it.prop(
    '∀r_StaticVerdict_≡CountedAndCostedApart',
    { of: [runResultsArb], subject: staticVerdictOf },
    (subject, [results]) => {
      const statics = staticResultsOf(results)
      const verdict = subject(results)
      return Arr.isReadonlyArrayNonEmpty(statics)
        ? verdict !== null &&
          verdict.count === statics.length &&
          verdict.costMs === Arr.reduce(statics, 0, (total, result) => total + costTotalOf(result))
        : verdict === null
    },
  )
})
