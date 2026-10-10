import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { checkMutants, type CheckOutcome } from '../check-mutants.workflow.js'
import { CheckMutantsInput, type DiagnosticDecoded, DiagnosticLine, MutantVerdict } from '../CheckMutants.schema.js'

type Status = 'passed' | 'compileError' | 'ignored'

interface Expected {
  readonly id: string
  readonly status: Status
  readonly reason: string
}

const renderedLine = (diagnostic: DiagnosticDecoded): string =>
  diagnostic.position + diagnostic.severity + ' TS' + diagnostic.code + ': ' + diagnostic.text

const expectedOutcomes = (input: CheckMutantsInput): ReadonlyArray<Expected> => {
  const verdicts = HashMap.fromIterable(Arr.map(input.verdicts, (verdict) => [verdict.id, verdict] as const))
  return Arr.map(input.mutants, (mutant) => {
    const verdict: MutantVerdict = Option.getOrElse(
      HashMap.get(verdicts, mutant.id),
      () => MutantVerdict.make({ id: mutant.id, diagnostics: [] }),
    )
    const reason = Arr.map(verdict.diagnostics, renderedLine).join('\n')
    if (reason !== '') return { id: mutant.id, status: 'compileError' as const, reason }
    if (verdict.tce === 'original') {
      return { id: mutant.id, status: 'ignored' as const, reason: 'equivalent-to-original: tce' }
    }
    if (verdict.tce === 'sibling') {
      return { id: mutant.id, status: 'ignored' as const, reason: 'duplicate-at-site: tce' }
    }
    return { id: mutant.id, status: 'passed' as const, reason: '' }
  })
}

const observedOutcomes = (outcomes: ReadonlyArray<CheckOutcome>): ReadonlyArray<Expected> =>
  Arr.map(outcomes, (outcome) =>
    Match.value(outcome).pipe(
      Match.tag('MutantPassed', (passed): Expected => ({ id: passed.id, status: 'passed', reason: '' })),
      Match.tag('MutantFailed', (failed): Expected => ({
        id: failed.id,
        status: 'compileError',
        reason: failed.reason,
      })),
      Match.tag('MutantIgnored', (ignored): Expected => ({
        id: ignored.id,
        status: 'ignored',
        reason: ignored.reason,
      })),
      Match.exhaustive,
    ))

const decidedIds = (outcomes: ReadonlyArray<CheckOutcome>): ReadonlyArray<string> =>
  Arr.map(outcomes, (outcome) => outcome.id)

const DiagnosticLines = S.NonEmptyArray(DiagnosticLine)

const wireOf = (wire: Checker.CheckerMutantWire, diagnostics: ReadonlyArray<DiagnosticLine>): CheckMutantsInput =>
  CheckMutantsInput.make({
    mutants: [wire],
    verdicts: [MutantVerdict.make({ id: wire.id, diagnostics: [...diagnostics] })],
  })

const failedReasonOf = (wire: Checker.CheckerMutantWire, diagnostics: ReadonlyArray<DiagnosticLine>): string =>
  Result.match(checkMutants(wireOf(wire, diagnostics)), {
    onFailure: () => '',
    onSuccess: (outcomes) =>
      Option.getOrElse(
        Option.map(Arr.head(outcomes), (outcome) =>
          Match.value(outcome).pipe(
            Match.tag('MutantFailed', (failed): string => failed.reason),
            Match.orElse((): string => ''),
          )),
        () => '',
      ),
  })

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

  it.prop(
    '∀diagnostics_FailedReason_≡RenderedLinesJoinedByNewline',
    { of: [Checker.CheckerMutantWire, DiagnosticLines], subject: failedReasonOf },
    (subject, [wire, diagnostics]) =>
      subject(wire, diagnostics) === Arr.map(diagnostics, (line) => line.rendered).join('\n'),
  )
})
