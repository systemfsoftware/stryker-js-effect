import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { costOrZero } from '../mutant-cost.js'

export const staticVerdictOf = (results: readonly Mutant.RunMutantResult[]): RunEvent.StaticVerdict | null => {
  const statics = Arr.filter(results, (result) => result.static === true)
  return Option.match(Arr.head(statics), {
    onNone: () => null,
    onSome: () =>
      RunEvent.StaticVerdict.make({
        count: statics.length,
        costMs: Arr.reduce(statics, 0, (total, result) => total + costOrZero(result.cost)),
      }),
  })
}
