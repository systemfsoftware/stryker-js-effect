/// <reference types="vitest/importMeta" />
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const AnnotationMarker = S.Literal('@stryker-expect')
export type AnnotationMarker = typeof AnnotationMarker.Type

export const Scope = S.Literals(['Line', 'Declaration', 'File'])
export type Scope = typeof Scope.Type

export const TsCode = S.String.pipe(
  S.check(S.isPattern(/^TS[0-9]+$/, { expected: 'a TypeScript diagnostic code such as TS2322' })),
  S.brand('TsCode'),
)
export type TsCode = typeof TsCode.Type

export const ErrorClass = S.String.pipe(
  S.check(S.isPattern(/^[A-Z][A-Za-z0-9]*$/, { expected: 'an error class name such as TypeError' })),
  S.brand('ErrorClass'),
)
export type ErrorClass = typeof ErrorClass.Type

export class AnnotationStatusOutcome extends S.TaggedClass<AnnotationStatusOutcome>()('Status', {
  status: Mutant.MutantStatusSchema,
}) {}

export class KilledOrTimeoutOutcome extends S.TaggedClass<KilledOrTimeoutOutcome>()('KilledOrTimeout', {}) {}

export class CompileErrorOutcome extends S.TaggedClass<CompileErrorOutcome>()('CompileError', {
  code: TsCode,
}) {}

export class RuntimeErrorOutcome extends S.TaggedClass<RuntimeErrorOutcome>()('RuntimeError', {
  errorClass: ErrorClass,
}) {}

export const Outcome = S.Union([
  AnnotationStatusOutcome,
  KilledOrTimeoutOutcome,
  CompileErrorOutcome,
  RuntimeErrorOutcome,
])
export type Outcome = typeof Outcome.Type

export class AllMutators extends S.TaggedClass<AllMutators>()('All', {}) {}

export class NamedMutators extends S.TaggedClass<NamedMutators>()('Named', {
  names: S.Array(Mutant.MutatorName),
}) {}

export const MutatorTarget = S.Union([AllMutators, NamedMutators])
export type MutatorTarget = typeof MutatorTarget.Type

export const SourceLine = S.Struct({ number: S.Int, text: S.String })
export type SourceLine = typeof SourceLine.Type

const AnnotationTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/Annotation')
type AnnotationTypeId = typeof AnnotationTypeId

export class Annotation extends S.TaggedClass<Annotation>()('Annotation', {
  line: S.Int,
  scope: Scope,
  range: Mutant.Location,
  outcome: Outcome,
  mutators: MutatorTarget,
  slices: S.String.pipe(S.Array, S.optional),
}) {
  readonly [AnnotationTypeId] = AnnotationTypeId
}

export const SourcedAnnotation = S.Struct({ file: S.String, annotation: Annotation })
export type SourcedAnnotation = typeof SourcedAnnotation.Type

export class AnnotationUnreadable extends S.TaggedError<AnnotationUnreadable>()('AnnotationUnreadable', {
  file: S.String,
  line: S.Int,
  text: S.String,
  reason: S.String,
}) {
  override get message(): string {
    return `${this.file}:${this.line}: ${this.reason}: ${this.text}`
  }
}

export class AnnotationRangeUnresolved extends S.TaggedError<AnnotationRangeUnresolved>()('AnnotationRangeUnresolved', {
  file: S.String,
  line: S.Int,
  reason: S.String,
}) {
  override get message(): string {
    return `${this.file}:${this.line}: the annotated scope has no source range: ${this.reason}`
  }
}

export const AnnotationParseFailure = S.Union([AnnotationUnreadable, AnnotationRangeUnresolved])
export type AnnotationParseFailure = typeof AnnotationParseFailure.Type

const acceptsTsCode = (value: string): boolean => S.is(TsCode)(value)
const acceptsErrorClass = (value: string): boolean => S.is(ErrorClass)(value)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const boundaryValues = [
    '',
    'TS',
    'TS1',
    'TS2322',
    'TS-1',
    'TS12a',
    'ts2322',
    ' TS2322',
    'A',
    'Error',
    'TypeError',
    'error',
    'Type_Error',
    'Érror',
  ]
  const withBoundaries = (drawn: string): ReadonlyArray<string> => Arr.appendAll([...boundaryValues], [drawn])

  it.prop(
    '∀s_TsCodeRefusal_≡DiagnosticCodePattern',
    { of: [S.String], subject: acceptsTsCode },
    (subject, [drawn]) => Arr.every(withBoundaries(drawn), (value) => subject(value) === /^TS[0-9]+$/.test(value)),
  )

  it.prop(
    '∀s_ErrorClassRefusal_≡ClassNamePattern',
    { of: [S.String], subject: acceptsErrorClass },
    (subject, [drawn]) =>
      Arr.every(withBoundaries(drawn), (value) => subject(value) === /^[A-Z][A-Za-z0-9]*$/.test(value)),
  )
}
