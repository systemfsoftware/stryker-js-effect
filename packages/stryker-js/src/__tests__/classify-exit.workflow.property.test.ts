import { describe, it } from '@effect/vitest'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { classifyExit, ClassifyExitCommand } from '../classify-exit.workflow.js'

const decidedOf = (pending: ReadonlyArray<ExitClass>, score: number | null, breakingThreshold: number | null) =>
  classifyExit(new ClassifyExitCommand({ pending: [...pending], signal: null, score, breakingThreshold }))
describe('classifyExit', () => {
  it.prop('∀pair_Command_≡HighestSeverity', [ExitClass, ExitClass], ([first, second]) => {
    const result = decidedOf([first, second], null, null)
    if (Result.isFailure(result)) {
      return false
    }
    return Option.match(Option.fromNullishOr(result.success.highestClass), {
      onNone: () => false,
      onSome: (highest) =>
        ExitClass.EXIT_CODE[highest] >= ExitClass.EXIT_CODE[first] &&
        ExitClass.EXIT_CODE[highest] >= ExitClass.EXIT_CODE[second] &&
        (highest === first || highest === second),
    })
  })

  it.prop('∀single_Command_∈Members', [ExitClass], ([only]) => {
    const result = decidedOf([only], null, null)
    return Result.match(result, {
      onFailure: () => false,
      onSuccess: (decision) => decision.highestClass === only,
    })
  })

  it.prop('∀score_Command_≡ThresholdVerdict', [ExitClass, ExitClass], ([first, second]) => {
    const below = decidedOf([first, second], 10, 50)
    const above = decidedOf([first, second], 90, 50)
    const unset = decidedOf([first, second], 10, null)
    return (
      Result.isSuccess(below) && below.success.verdictClass === 'VerdictFail' &&
      Result.isSuccess(above) && above.success.verdictClass === null &&
      Result.isSuccess(unset) && unset.success.verdictClass === null
    )
  })
})
