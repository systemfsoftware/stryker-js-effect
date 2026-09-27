import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type Outcome } from './annotation.schema.js'
import { MatchedAnnotation } from './match-annotations.workflow.js'

export class ConfirmAnnotationsCommand extends S.TaggedClass<ConfirmAnnotationsCommand>()(
  'ConfirmAnnotationsCommand',
  {
    matched: S.Array(MatchedAnnotation),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const OutcomeTallyTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/OutcomeTally')
type OutcomeTallyTypeId = typeof OutcomeTallyTypeId

export class OutcomeTally extends S.TaggedClass<OutcomeTally>()('OutcomeTally', {
  matched: S.Int,
  byStatus: S.Record(S.String, S.Int),
  byMutator: S.Record(S.String, S.Int),
}) {
  readonly [OutcomeTallyTypeId] = OutcomeTallyTypeId
}

const KILLED_OR_TIMEOUT_STATUSES: ReadonlyArray<string> = ['Killed', 'Timeout']

export class AnnotationStatusMismatch extends S.TaggedError<AnnotationStatusMismatch>()(
  'AnnotationStatusMismatch',
  {
    file: S.String,
    line: S.Int,
    column: S.Int,
    mutator: S.String,
    expected: S.String,
    actual: S.String,
  },
) {
  override get message(): string {
    return `${this.file}:${this.line}:${this.column}: the ${this.mutator} mutant was annotated ${this.expected} but the run reported ${this.actual}`
  }
}

export class AnnotationCauseMismatch extends S.TaggedError<AnnotationCauseMismatch>()('AnnotationCauseMismatch', {
  file: S.String,
  line: S.Int,
  column: S.Int,
  mutator: S.String,
  expectedCause: S.String,
  actualReason: S.String,
}) {
  override get message(): string {
    return `${this.file}:${this.line}:${this.column}: the ${this.mutator} mutant was annotated ${this.expectedCause}, but the reported reason names no such cause: ${this.actualReason}`
  }
}

export const ConfirmFailure = S.Union([AnnotationStatusMismatch, AnnotationCauseMismatch])
export type ConfirmFailure = typeof ConfirmFailure.Type

const outcomeKey = (outcome: Outcome): string =>
  Match.value(outcome).pipe(
    Match.tag('Status', ({ status }) => status),
    Match.tag('KilledOrTimeout', () => 'KilledOrTimeout'),
    Match.tag('CompileError', ({ code }) => `CompileError(${code})`),
    Match.tag('RuntimeError', ({ errorClass }) => `RuntimeError(${errorClass})`),
    Match.exhaustive,
  )

const acceptsStatus = (outcome: Outcome, status: string): boolean =>
  Match.value(outcome).pipe(
    Match.tag('Status', ({ status: expected }) => expected === status),
    Match.tag('KilledOrTimeout', () => KILLED_OR_TIMEOUT_STATUSES.includes(status)),
    Match.tag('CompileError', () => status === 'CompileError'),
    Match.tag('RuntimeError', () => status === 'RuntimeError'),
    Match.exhaustive,
  )

const causeTextOf = (outcome: Outcome): string =>
  Match.value(outcome).pipe(
    Match.tag('Status', () => ''),
    Match.tag('KilledOrTimeout', () => ''),
    Match.tag('CompileError', ({ code }) => `error ${code}:`),
    Match.tag('RuntimeError', ({ errorClass }) => errorClass),
    Match.exhaustive,
  )

const WHOLE_IDENTIFIER_CHARS = 'A-Za-z0-9_$'

const wholeIdentifierPattern = (identifier: string): RegExp =>
  new RegExp(`(^|[^${WHOLE_IDENTIFIER_CHARS}])${identifier}([^${WHOLE_IDENTIFIER_CHARS}]|$)`)

const containsDiagnostic = (code: string, reason: string): boolean => reason.includes(`error ${code}:`)

const containsErrorClass = (errorClass: string, reason: string): boolean =>
  wholeIdentifierPattern(errorClass).test(reason)

const causeExplainedBy = (outcome: Outcome, statusReason: string | undefined): boolean => {
  const reason = Option.getOrElse(Option.fromUndefinedOr(statusReason), () => '')
  return Match.value(outcome).pipe(
    Match.tag('Status', () => true),
    Match.tag('KilledOrTimeout', () => true),
    Match.tag('CompileError', ({ code }) => containsDiagnostic(code, reason)),
    Match.tag('RuntimeError', ({ errorClass }) => containsErrorClass(errorClass, reason)),
    Match.exhaustive,
  )
}

const stepOf = (matched: MatchedAnnotation): Result.Result<MatchedAnnotation, ConfirmFailure> =>
  Boolean.match(acceptsStatus(matched.annotation.annotation.outcome, matched.mutant.mutant.status), {
    onTrue: () =>
      Boolean.match(causeExplainedBy(matched.annotation.annotation.outcome, matched.mutant.mutant.statusReason), {
        onTrue: () => Result.succeed(matched),
        onFalse: () =>
          Result.fail(
            AnnotationCauseMismatch.make({
              file: matched.mutant.file,
              line: matched.mutant.mutant.location.start.line,
              column: matched.mutant.mutant.location.start.column,
              mutator: matched.mutant.mutant.mutatorName,
              expectedCause: causeTextOf(matched.annotation.annotation.outcome),
              actualReason: Option.getOrElse(Option.fromUndefinedOr(matched.mutant.mutant.statusReason), () => ''),
            }),
          ),
      }),
    onFalse: () =>
      Result.fail(
        AnnotationStatusMismatch.make({
          file: matched.mutant.file,
          line: matched.mutant.mutant.location.start.line,
          column: matched.mutant.mutant.location.start.column,
          mutator: matched.mutant.mutant.mutatorName,
          expected: outcomeKey(matched.annotation.annotation.outcome),
          actual: matched.mutant.mutant.status,
        }),
      ),
  })

const confirmedOf = (
  matched: ReadonlyArray<MatchedAnnotation>,
): Result.Result<ReadonlyArray<MatchedAnnotation>, ConfirmFailure> =>
  matched.reduce<Result.Result<ReadonlyArray<MatchedAnnotation>, ConfirmFailure>>(
    (accumulated, entry) =>
      Result.flatMap(accumulated, (confirmed) => Result.map(stepOf(entry), (value) => [...confirmed, value])),
    Result.succeed([]),
  )

const incremented = (counts: Readonly<Record<string, number>>, name: string): Record<string, number> => ({
  ...counts,
  [name]: Option.getOrElse(Option.fromUndefinedOr(counts[name]), () => 0) + 1,
})

const counted = (
  matched: ReadonlyArray<MatchedAnnotation>,
  keyOf: (entry: MatchedAnnotation) => string,
): Record<string, number> =>
  matched.reduce<Record<string, number>>((counts, entry) => incremented(counts, keyOf(entry)), {})

const tallyOf = (matched: ReadonlyArray<MatchedAnnotation>): OutcomeTally =>
  OutcomeTally.make({
    matched: matched.length,
    byStatus: counted(matched, (entry) => outcomeKey(entry.annotation.annotation.outcome)),
    byMutator: counted(matched, (entry) => entry.mutant.mutant.mutatorName),
  })

const decide = (command: ConfirmAnnotationsCommand): Result.Result<OutcomeTally, ConfirmFailure> =>
  Result.map(confirmedOf(command.matched), tallyOf)

export const confirmAnnotations = Workflow.make({
  command: ConfirmAnnotationsCommand,
  decision: OutcomeTally,
  error: ConfirmFailure,
  decide,
})
