import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  AllMutators,
  Annotation,
  AnnotationStatusOutcome,
  CompileErrorOutcome,
  ErrorClass,
  KilledOrTimeoutOutcome,
  type Outcome,
  RuntimeErrorOutcome,
  TsCode,
} from '../annotation.schema.js'
import {
  AnnotationCauseMismatch,
  AnnotationStatusMismatch,
  confirmAnnotations,
  ConfirmAnnotationsCommand,
} from '../confirm-annotations.workflow.js'
import { MatchedAnnotation } from '../match-annotations.workflow.js'
import type { ReportMutant } from '../match.schema.js'

const FILE = 'src/subject.ts'
const NARROW_RANGE: Mutant.Location = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }

const mutantOf = (
  mutatorName: string,
  status: Mutant.MutantStatus,
  statusReason?: string,
): ReportMutant => ({
  file: FILE,
  mutant: {
    id: `mutant-${mutatorName}`,
    mutatorName,
    location: NARROW_RANGE,
    status,
    ...(statusReason === undefined ? {} : { statusReason }),
  },
})

const matchedOf = (
  mutatorName: string,
  status: Mutant.MutantStatus,
  outcome: Outcome,
  statusReason?: string,
): MatchedAnnotation =>
  MatchedAnnotation.make({
    mutant: mutantOf(mutatorName, status, statusReason),
    annotation: {
      file: FILE,
      annotation: Annotation.make({
        line: 1,
        scope: 'Line',
        range: NARROW_RANGE,
        outcome,
        mutators: AllMutators.make({}),
      }),
    },
  })

const commandOf = (entries: ReadonlyArray<MatchedAnnotation>) =>
  ConfirmAnnotationsCommand.make({ matched: [...entries] })

const pairArb = Arbitrary.schema(S.Tuple([Mutant.MutantStatusSchema, Mutant.MutatorName]))

describe('confirmAnnotations', () => {
  it.prop(
    '∀s_MatchingStatus_≡ConfirmedAndCounted',
    { of: [Mutant.MutantStatusSchema, Mutant.MutatorName], subject: confirmAnnotations },
    (subject, [status, mutatorName]) => {
      const entry = matchedOf(mutatorName, status, AnnotationStatusOutcome.make({ status }))
      return Result.match(subject(commandOf([entry])), {
        onFailure: () => false,
        onSuccess: (tally) =>
          tally.matched === 1 &&
          tally.byStatus[status] === 1 &&
          tally.byMutator[mutatorName] === 1,
      })
    },
  )

  it.prop(
    '∀s_DivergentStatus_≡RefusedNamingBothStatuses',
    { of: [Mutant.MutantStatusSchema, Mutant.MutantStatusSchema, Mutant.MutatorName], subject: confirmAnnotations },
    (subject, [annotated, reported, mutatorName]) => {
      if (annotated === reported) {
        return true
      }
      const entry = matchedOf(mutatorName, reported, AnnotationStatusOutcome.make({ status: annotated }))
      return Result.match(subject(commandOf([entry])), {
        onFailure: (failure) =>
          S.is(AnnotationStatusMismatch)(failure) &&
          failure.mutator === mutatorName &&
          failure.expected === annotated &&
          failure.actual === reported,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀s_KilledOrTimeout_≡MatchesKilledAndTimeoutOnly',
    { of: [Mutant.MutantStatusSchema, Mutant.MutatorName], subject: confirmAnnotations },
    (subject, [status, mutatorName]) => {
      const entry = matchedOf(mutatorName, status, KilledOrTimeoutOutcome.make({}))
      const expected = status === 'Killed' || status === 'Timeout'
      return Result.match(subject(commandOf([entry])), {
        onFailure: (failure) => !expected && S.is(AnnotationStatusMismatch)(failure),
        onSuccess: (tally) => expected && tally.byStatus['KilledOrTimeout'] === 1,
      })
    },
  )

  it.prop(
    '∀c_DiagnosticCode_≡MatchesOnlyItsOwnDiagnostic',
    { of: [TsCode, Mutant.MutatorName], subject: confirmAnnotations },
    (subject, [code, mutatorName]) => {
      const outcome = CompileErrorOutcome.make({ code })
      const alone = matchedOf(mutatorName, 'CompileError', outcome, `error ${code}: alone`)
      const second = matchedOf(
        mutatorName,
        'CompileError',
        outcome,
        `error TS1000: first\nerror ${code}: second`,
      )
      const other = matchedOf(mutatorName, 'CompileError', outcome, 'error TS1000: first')
      const diverges = code === 'TS1000'
        ? true
        : Result.match(subject(commandOf([other])), {
          onFailure: (failure) => S.is(AnnotationCauseMismatch)(failure) && failure.expectedCause === `error ${code}:`,
          onSuccess: () => false,
        })
      return Result.match(subject(commandOf([alone])), {
        onFailure: () => false,
        onSuccess: () =>
          Result.isSuccess(subject(commandOf([second]))) &&
          diverges,
      })
    },
  )

  it.prop(
    '∀c_ErrorClass_≡MatchesWholeIdentifierOnly',
    { of: [ErrorClass, Mutant.MutatorName], subject: confirmAnnotations },
    (subject, [errorClass, mutatorName]) => {
      const outcome = RuntimeErrorOutcome.make({ errorClass })
      const called = matchedOf(mutatorName, 'RuntimeError', outcome, `${errorClass}: called with no receiver`)
      const prefixed = matchedOf(mutatorName, 'RuntimeError', outcome, `${errorClass}Extra: called with no receiver`)
      return Result.match(subject(commandOf([called])), {
        onFailure: () => false,
        onSuccess: () =>
          Result.match(subject(commandOf([prefixed])), {
            onFailure: (failure) =>
              S.is(AnnotationCauseMismatch)(failure) &&
              failure.expectedCause === errorClass &&
              failure.actualReason.includes(`${errorClass}Extra`),
            onSuccess: () => false,
          }),
      })
    },
  )

  it.prop(
    '∀p_TwoDistinctMatchedPairs_≡TallyCountsEachKeyOnce',
    { of: [pairArb, pairArb], subject: confirmAnnotations },
    (subject, [first, second]) => {
      const [firstStatus, firstName] = first
      const [secondStatus, secondName] = second
      if (firstStatus === secondStatus || firstName === secondName) {
        return true
      }
      const entries = [
        matchedOf(firstName, firstStatus, AnnotationStatusOutcome.make({ status: firstStatus })),
        matchedOf(secondName, secondStatus, AnnotationStatusOutcome.make({ status: secondStatus })),
      ]
      return Result.match(subject(commandOf(entries)), {
        onFailure: () => false,
        onSuccess: (tally) =>
          tally.matched === 2 &&
          tally.byStatus[firstStatus] === 1 &&
          tally.byStatus[secondStatus] === 1 &&
          tally.byMutator[firstName] === 1 &&
          tally.byMutator[secondName] === 1 &&
          Object.keys(tally.byStatus).length === 2 &&
          Object.keys(tally.byMutator).length === 2,
      })
    },
  )
})
