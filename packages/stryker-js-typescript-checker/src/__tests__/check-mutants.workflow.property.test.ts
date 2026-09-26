import { describe } from '@systemfsoftware/vitest'
import { Match } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { checkMutants, DiagnosticInUnrelatedFileError, DiagnosticWithoutFileError } from '../check-mutants.workflow.js'
import { CheckMutantsInput } from '../CheckMutants.schema.js'

const setsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value))

const isSubset = (inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean =>
  [...inner].every((value) => outer.has(value))

const isDisjoint = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  [...left].every((value) => !right.has(value))

describe('checkMutants', (it) => {
  it.prop(
    '∀i_Decision_≡Partitioned',
    { of: [CheckMutantsInput], subject: checkMutants },
    (subject, [input]) => {
      const result = subject(input)
      if (Result.isFailure(result)) {
        return (
          S.is(DiagnosticWithoutFileError)(result.failure) ||
          S.is(DiagnosticInUnrelatedFileError)(result.failure)
        )
      }
      const ids = new Set(input.mutants.map((mutant) => mutant.id))
      const keys = new Set(Object.keys(result.success.results))
      return Match.value(result.success).pipe(
        Match.tag('CheckFinished', () => setsEqual(keys, ids)),
        Match.tag('RetestRequired', (retry) => {
          const retest = new Set(retry.needsRetest.map((mutant) => mutant.id))
          return (
            retry.needsRetest.length > 0 &&
            isSubset(retest, ids) &&
            isDisjoint(keys, retest) &&
            setsEqual(new Set([...keys, ...retest]), ids)
          )
        }),
        Match.exhaustive,
      )
    },
  )
})
