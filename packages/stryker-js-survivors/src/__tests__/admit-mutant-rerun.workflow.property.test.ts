import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equivalence from 'effect/Equivalence'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitMutantRerun,
  AdmitMutantRerunCommand,
  RerunAdmitted,
  RerunRefused,
} from '../Rerun/admit-mutant-rerun.workflow.js'

const stringArrayEquivalence = Equivalence.Array(Equivalence.String)

const spanOf = (mutant: {
  readonly relativeFileName: string
  readonly location: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}): string =>
  `${mutant.relativeFileName}:${mutant.location.start.line}:${mutant.location.start.column}-${mutant.location.end.line}:${mutant.location.end.column}`

const requestedOf = (command: AdmitMutantRerunCommand): ReadonlyArray<Mutant.MutantId> => Arr.dedupe(command.ids)

const knownIdsOf = (command: AdmitMutantRerunCommand): ReadonlySet<string> =>
  new Set(command.priorMutants.map((mutant) => mutant.id))

const unknownOf = (command: AdmitMutantRerunCommand): ReadonlyArray<Mutant.MutantId> =>
  requestedOf(command).filter((id) => !knownIdsOf(command).has(id))

const selectedOf = (command: AdmitMutantRerunCommand) =>
  requestedOf(command).map((id) => Option.getOrThrow(Arr.findFirst(command.priorMutants, (mutant) => mutant.id === id)))

const decisionOf = (subject: typeof admitMutantRerun, command: AdmitMutantRerunCommand) =>
  Result.getOrThrow(subject(command))

const allPriorMutantsRequested = (command: AdmitMutantRerunCommand): AdmitMutantRerunCommand =>
  AdmitMutantRerunCommand.make({
    ids: command.priorMutants.map((mutant) => mutant.id),
    priorMutants: command.priorMutants,
    priorReportPath: command.priorReportPath,
  })

describe('admitMutantRerun', () => {
  it.prop(
    '∀c_AdmitMutantRerunCommand_≡RefusedExactlyWhenAnIdIsAbsentFromThePriorReportAndAdmittedOtherwise',
    { of: [AdmitMutantRerunCommand], subject: admitMutantRerun },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      const unknown = unknownOf(command)
      if (unknown.length > 0) {
        if (!S.is(RerunRefused)(decision)) {
          return false
        }
        return stringArrayEquivalence(decision.unknownIds, unknown) &&
          Arr.every(unknown, (id) => decision.reason.includes(id)) &&
          decision.reason.includes(command.priorReportPath)
      }
      if (!S.is(RerunAdmitted)(decision)) {
        return false
      }
      return stringArrayEquivalence(decision.ids, requestedOf(command)) &&
        stringArrayEquivalence(decision.mutateSpans, Arr.dedupe(selectedOf(command).map(spanOf)))
    },
  )

  it.prop(
    '∀c_EveryPriorMutantRequested_≡AdmittedWithThoseIdsAndSpans',
    { of: [AdmitMutantRerunCommand], subject: admitMutantRerun },
    (subject, [command]) => {
      const request = allPriorMutantsRequested(command)
      const decision = decisionOf(subject, request)
      if (!S.is(RerunAdmitted)(decision)) {
        return false
      }
      const expectedIds = Arr.dedupe(request.priorMutants.map((mutant) => mutant.id))
      return stringArrayEquivalence(decision.ids, expectedIds) &&
        stringArrayEquivalence(decision.mutateSpans, Arr.dedupe(request.priorMutants.map(spanOf)))
    },
  )
})
