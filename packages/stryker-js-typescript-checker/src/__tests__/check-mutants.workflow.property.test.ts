import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import { Match, Option } from 'effect'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { checkMutants, DiagnosticInUnrelatedFileError, DiagnosticWithoutFileError } from '../check-mutants.workflow.js'
import { CheckMutantsInput, type DiagnosticDecoded } from '../CheckMutants.schema.js'

const setsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value))

const renderedLine = (diagnostic: DiagnosticDecoded): string =>
  diagnostic.position + diagnostic.severity + ' TS' + diagnostic.code + ': ' + diagnostic.text

const soleMutantInput = (input: CheckMutantsInput): Option.Option<CheckMutantsInput> =>
  Option.map(Arr.head(input.mutants), (mutant) => {
    const fileName = Mutant.CanonicalFileName.make(`${mutant.fileName}.ts`)
    return CheckMutantsInput.make({
      mutants: [{ ...mutant, fileName }],
      diagnostics: [...input.diagnostics],
      nodes: { ...input.nodes, [fileName]: { fileName, parents: [], children: [] } },
    })
  })

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

  it.prop(
    '∀i_CompileErrorReason_≡RenderedDiagnosticLines',
    { of: [CheckMutantsInput], subject: checkMutants },
    (subject, [input]) => {
      const sole = soleMutantInput(input)
      if (Option.isNone(sole)) return true
      const result = subject(sole.value)
      if (Result.isFailure(result)) return true
      const mutant = Arr.head(sole.value.mutants)
      if (Option.isNone(mutant)) return true
      const answer = result.success.results[mutant.value.id]
      if (answer === undefined) return false
      return answer.status === 'passed'
        ? sole.value.diagnostics.length === 0
        : answer.reason === Arr.map(sole.value.diagnostics, renderedLine).join('\n')
    },
  )
})
