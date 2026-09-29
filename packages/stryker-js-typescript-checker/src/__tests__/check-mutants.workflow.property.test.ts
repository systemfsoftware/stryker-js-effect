import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { checkMutants, type CheckOutcome } from '../check-mutants.workflow.js'
import { CheckMutantsInput, type DiagnosticDecoded } from '../CheckMutants.schema.js'

interface Expected {
  readonly id: string
  readonly failed: boolean
  readonly reason: string
}

const renderedLine = (diagnostic: DiagnosticDecoded): string =>
  diagnostic.position + diagnostic.severity + ' TS' + diagnostic.code + ': ' + diagnostic.text

const expectedOutcomes = (input: CheckMutantsInput): ReadonlyArray<Expected> => {
  const diagnostics = HashMap.fromIterable(
    Arr.map(input.verdicts, (verdict) => [verdict.id, verdict.diagnostics] as const),
  )
  return Arr.map(input.mutants, (mutant) => {
    const reason = Arr.map(
      Option.getOrElse(HashMap.get(diagnostics, mutant.id), (): ReadonlyArray<DiagnosticDecoded> => []),
      renderedLine,
    ).join('\n')
    return { id: mutant.id, failed: reason !== '', reason }
  })
}

const observedOutcomes = (outcomes: ReadonlyArray<CheckOutcome>): ReadonlyArray<Expected> =>
  Arr.map(outcomes, (outcome) =>
    Match.value(outcome).pipe(
      Match.tag('MutantPassed', (passed): Expected => ({ id: passed.id, failed: false, reason: '' })),
      Match.tag('MutantFailed', (failed): Expected => ({ id: failed.id, failed: true, reason: failed.reason })),
      Match.exhaustive,
    ))

const decidedIds = (outcomes: ReadonlyArray<CheckOutcome>): ReadonlyArray<string> =>
  Arr.map(outcomes, (outcome) => outcome.id)

describe('checkMutants', (it) => {
  it.prop(
    '∀i_Outcomes_≡OnePerMutantInOrder',
    { of: [CheckMutantsInput], subject: checkMutants },
    (subject, [input]) =>
      Result.match(subject(input), {
        onFailure: () => false,
        onSuccess: (outcomes) => Equal.equals(decidedIds(outcomes), Arr.map(input.mutants, (mutant) => mutant.id)),
      }),
  )

  it.prop(
    '∀i_Outcomes_≡OwnRenderedDiagnostics',
    { of: [CheckMutantsInput], subject: checkMutants },
    (subject, [input]) =>
      Result.match(subject(input), {
        onFailure: () => false,
        onSuccess: (outcomes) => Equal.equals(observedOutcomes(outcomes), expectedOutcomes(input)),
      }),
  )
})
