import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Equal from 'effect/Equal'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  AllMutators,
  AnnotationRangeUnresolved,
  AnnotationUnreadable,
  KilledOrTimeoutOutcome,
  type MutatorItem,
  MutatorTarget,
  NamedMutators,
  Outcome,
  type Scope,
  type SourceLine,
} from '../annotation.schema.js'
import { parseAnnotations, ParseAnnotationsCommand } from '../parse-annotations.workflow.js'

const FILE = 'src/subject.ts'

const SCOPE_TOKENS: Readonly<Record<Scope, string>> = { Line: 'next-line', Declaration: '', File: 'file' }

const BODY: readonly [string, string, string] = ['const subject = () => {', '  return 1', '}']

const INVALID_OUTCOMES = [
  'MysteryLanguage',
  'CompileError()',
  'CompileError(TS)',
  'RuntimeError(Error)',
  'RuntimeError(typeError)',
  'KilledOrTimeout(1)',
  'KILLED',
] as const

const UNKNOWN_SCOPES = ['nextline', 'line', 'File', 'NEXT-LINE', 'declaration'] as const

const INVALID_MUTATOR_TEXTS = [
  '',
  'all,ArithmeticOperator',
  'arithmetic-operator',
  'acme/',
  '/Swap',
  'a/b/C',
  'killed',
  '0Killed',
  'Killed Two',
] as const

const EMPTY_SLICE_QUALIFIERS = ['[]', '[,]', '[ , ]'] as const

const INVALID_QUALIFIER_TEXTS = [
  'ArithmeticOperator="abc',
  'ArithmeticOperator=""',
  'all="x"',
  'ArithmeticOperator="\\q"',
  'ArithmeticOperator="a" junk',
  'ArithmeticOperator=',
  '="x"',
  'ArithmeticOperator="a", "b"',
] as const

const NON_EVENT_LINES = ['// a comment', 'NotAnAnnotation: ArithmeticOperator', ''] as const

const BRACKETED_REPLACEMENTS = ['[', ']', '[a]', 'x[0]', 'a]b[c', '["]', 'a, b: c'] as const

const isSafeSlice = (slice: string): boolean => slice.length > 0 && slice === slice.trim() && !/[,[\]@]/.test(slice)

const isSafeBodyLine = (line: string): boolean =>
  !line.includes('{') && !line.includes('}') && !line.includes('@stryker-expect')

const targetArb = Arbitrary.filter(
  Arbitrary.schema(MutatorTarget),
  (target) => S.is(AllMutators)(target) || target.items.length > 0,
)

const STACK_SIZES = [2, 3, 4] as const

const STACK_OUTCOME_TEXTS = [
  'Killed',
  'Survived',
  'KilledOrTimeout',
  'CompileError(TS2349)',
  'RuntimeError(TypeError)',
] as const

const stackedTextsOf = (size: number, first: string, second: string): ReadonlyArray<string> => [
  first,
  second,
  ...Array.from({ length: size - 2 }, () => first),
]

const stackedMarkerLine = (number: number, outcomeText: string, target: MutatorTarget): SourceLine =>
  lineOf(number, `// @stryker-expect next-line ${outcomeText}: ${targetTextOf(target)}`)

const stackedLinesOf = (outcomeTexts: ReadonlyArray<string>, target: MutatorTarget): ReadonlyArray<SourceLine> =>
  outcomeTexts.map((outcomeText, index) => stackedMarkerLine(index + 1, outcomeText, target))

const stackedRangesOf = (outcomeTexts: ReadonlyArray<string>, body: SourceLine): ReadonlyArray<Mutant.Location> =>
  outcomeTexts.map(() => rangeOnLine(body))

const bodyLinesArb = Arbitrary.filter(
  Arbitrary.array(Arbitrary.schema(S.String), { maxLength: 4 }),
  (lines) => lines.every(isSafeBodyLine),
)

const declarationBodyArb = Arbitrary.map(bodyLinesArb, (bodyLines) => ({
  bodyLines: bodyLines.map((text, index) => lineOf(3 + index, text)),
  closingLine: 3 + bodyLines.length,
}))

const sliceNamesArb = Arbitrary.array(
  Arbitrary.filter(Arbitrary.schema(S.String), isSafeSlice),
  { maxLength: 3 },
)

const outcomeTextOf = (outcome: Outcome): string =>
  Match.value(outcome).pipe(
    Match.tag('Status', ({ status }) => status),
    Match.tag('KilledOrTimeout', () => 'KilledOrTimeout'),
    Match.tag('CompileError', ({ code }) => `CompileError(${code})`),
    Match.tag('RuntimeError', ({ errorClass }) => `RuntimeError(${errorClass})`),
    Match.exhaustive,
  )

const itemTextOf = (item: MutatorItem): string =>
  Option.match(Option.fromUndefinedOr(item.replacement), {
    onNone: () => item.name,
    onSome: (replacement) => `${item.name}=${JSON.stringify(replacement)}`,
  })

const canonicalItemOf = (item: MutatorItem): MutatorItem =>
  Option.match(Option.fromUndefinedOr(item.replacement), {
    onNone: () => ({ name: item.name }),
    onSome: (replacement) => ({ name: item.name, replacement }),
  })

const canonicalTargetOf = (target: MutatorTarget): MutatorTarget =>
  Match.value(target).pipe(
    Match.tag('All', () => target),
    Match.tag('Named', ({ items }) => NamedMutators.make({ items: items.map(canonicalItemOf) })),
    Match.exhaustive,
  )

const targetTextOf = (target: MutatorTarget): string =>
  Match.value(target).pipe(
    Match.tag('All', () => 'all'),
    Match.tag('Named', ({ items }) => items.map(itemTextOf).join(', ')),
    Match.exhaustive,
  )

const markerTextOf = (
  scope: Scope,
  outcome: Outcome,
  target: MutatorTarget,
  slices: ReadonlyArray<string>,
): string =>
  [
    '// @stryker-expect',
    SCOPE_TOKENS[scope],
    `${outcomeTextOf(outcome)}: ${targetTextOf(target)}`,
    slices.length > 0 ? `[${slices.join(', ')}]` : '',
  ].filter((part) => part.length > 0).join(' ')

const lineOf = (number: number, text: string): SourceLine => ({ number, text })

const rangeOnLine = (line: SourceLine): Mutant.Location => ({
  start: { line: line.number, column: 1 },
  end: { line: line.number, column: line.text.length + 1 },
})

const markedBodyOf = (marker: string): ReadonlyArray<SourceLine> => [
  lineOf(1, marker),
  lineOf(2, BODY[0]),
  lineOf(3, BODY[1]),
  lineOf(4, BODY[2]),
]

const expectedRangeOf = (scope: Scope): Mutant.Location =>
  Match.value(scope).pipe(
    Match.when('Line', () => ({ start: { line: 2, column: 1 }, end: { line: 2, column: BODY[0].length + 1 } })),
    Match.when('Declaration', () => ({ start: { line: 2, column: 1 }, end: { line: 4, column: 2 } })),
    Match.when('File', () => ({ start: { line: 1, column: 1 }, end: { line: 4, column: BODY[2].length + 1 } })),
    Match.exhaustive,
  )

describe('parseAnnotations', () => {
  it.prop(
    '∀a_MarkerLine_≡ParsedToWhatWasWritten',
    {
      of: [S.Literals(['Line', 'Declaration', 'File']), Outcome, targetArb, sliceNamesArb],
      subject: parseAnnotations,
    },
    (subject, [scope, outcome, target, slices]) => {
      const marker = markerTextOf(scope, outcome, target, slices)
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines: markedBodyOf(marker) })), {
        onFailure: () => false,
        onSuccess: (annotations) => {
          if (annotations.length !== 1) {
            return false
          }
          const parsed = annotations[0]
          return Equal.equals(parsed.line, 1) &&
            Equal.equals(parsed.scope, scope) &&
            Equal.equals(parsed.outcome, outcome) &&
            Equal.equals(parsed.mutators, canonicalTargetOf(target)) &&
            Equal.equals(parsed.slices === undefined ? [] : parsed.slices, slices) &&
            Equal.equals(parsed.range, expectedRangeOf(scope))
        },
      })
    },
  )

  it.prop(
    '∀o_InvalidOutcomeText_≡RefusedNamingTheLine',
    { of: [S.Literals(INVALID_OUTCOMES)], subject: parseAnnotations },
    (subject, [outcomeText]) => {
      const lines = [
        lineOf(1, `// @stryker-expect next-line ${outcomeText}: ArithmeticOperator`),
        lineOf(2, BODY[2]),
      ]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) =>
          S.is(AnnotationUnreadable)(failure) && failure.line === 1 && failure.text.includes(outcomeText),
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀o_UnknownScopeToken_≡RefusedNamingTheLine',
    { of: [S.Literals(UNKNOWN_SCOPES)], subject: parseAnnotations },
    (subject, [scopeToken]) => {
      const lines = [lineOf(1, `// @stryker-expect ${scopeToken} Killed: ArithmeticOperator`), lineOf(2, BODY[2])]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) => S.is(AnnotationUnreadable)(failure) && failure.line === 1,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀m_InvalidMutatorText_≡RefusedNamingTheLine',
    { of: [S.Literals(INVALID_MUTATOR_TEXTS)], subject: parseAnnotations },
    (subject, [mutators]) => {
      const lines = [lineOf(1, `// @stryker-expect next-line Killed: ${mutators}`), lineOf(2, BODY[2])]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) => S.is(AnnotationUnreadable)(failure) && failure.line === 1,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀s_EmptySliceQualifier_≡RefusedNamingTheLine',
    { of: [S.Literals(EMPTY_SLICE_QUALIFIERS)], subject: parseAnnotations },
    (subject, [qualifier]) => {
      const lines = [
        lineOf(1, `// @stryker-expect next-line Killed: ArithmeticOperator ${qualifier}`),
        lineOf(2, BODY[2]),
      ]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) => S.is(AnnotationUnreadable)(failure) && failure.line === 1,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀n_DirectiveComment_≡ParsedAsNoAnnotation',
    { of: [Mutant.MutatorName], subject: parseAnnotations },
    (subject, [mutatorName]) => {
      const lines = [
        lineOf(1, `// Stryker disable next-line ${mutatorName}: a proven race`),
        lineOf(2, BODY[2]),
      ]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: () => false,
        onSuccess: (annotations) => annotations.length === 0,
      })
    },
  )

  it.prop(
    '∀l_UnmarkedSourceLines_≡ParsedAsNoAnnotation',
    { of: [S.Literals(NON_EVENT_LINES)], subject: parseAnnotations },
    (subject, [text]) => {
      const lines = [lineOf(1, text), lineOf(2, BODY[2])]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: () => false,
        onSuccess: (annotations) => annotations.length === 0,
      })
    },
  )

  it.prop(
    '∀b_DeclarationBodyLines_≡RangeEndsAfterTheClosingBrace',
    { of: [declarationBodyArb, targetArb], subject: parseAnnotations },
    (subject, [body, target]) => {
      const marker = markerTextOf('Declaration', KilledOrTimeoutOutcome.make({}), target, [])
      const lines = [
        lineOf(1, marker),
        lineOf(2, 'const f = () => {'),
        ...body.bodyLines,
        lineOf(body.closingLine, '}'),
      ]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: () => false,
        onSuccess: (annotations) =>
          annotations.length === 1 &&
          Equal.equals(annotations[0].range, {
            start: { line: 2, column: 1 },
            end: { line: body.closingLine, column: 2 },
          }),
      })
    },
  )

  it.prop(
    '∀a_TrailingLineScope_≡RefusedAsUnresolved',
    { of: [Outcome, targetArb], subject: parseAnnotations },
    (subject, [outcome, target]) => {
      const lines = [lineOf(1, BODY[2]), lineOf(2, markerTextOf('Line', outcome, target, []))]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) => S.is(AnnotationRangeUnresolved)(failure) && failure.line === 2,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀r_QualifiedMutatorItem_≡ParsedToTheDecodedReplacement',
    {
      of: [Mutant.MutatorName, S.NonEmptyString, S.Literals(['Line', 'Declaration', 'File'])],
      subject: parseAnnotations,
    },
    (subject, [mutatorName, replacement, scope]) => {
      const marker = `// @stryker-expect ${SCOPE_TOKENS[scope]} Killed: ${mutatorName}=${JSON.stringify(replacement)}`
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines: markedBodyOf(marker) })), {
        onFailure: () => false,
        onSuccess: (annotations) => {
          if (annotations.length !== 1) {
            return false
          }
          const target = annotations[0].mutators
          return S.is(NamedMutators)(target) &&
            Equal.equals(target.items, [{ name: mutatorName, replacement }]) &&
            Equal.equals(annotations[0].range, expectedRangeOf(scope))
        },
      })
    },
  )

  it.prop(
    '∀r_BracketedReplacement_≡ParsedWithItsSlicesIntact',
    {
      of: [Mutant.MutatorName, S.Literals(BRACKETED_REPLACEMENTS), S.Literals(['calc', 'per-test'])],
      subject: parseAnnotations,
    },
    (subject, [mutatorName, replacement, slice]) => {
      const marker = `// @stryker-expect next-line Killed: ${mutatorName}=${JSON.stringify(replacement)} [${slice}]`
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines: markedBodyOf(marker) })), {
        onFailure: () => false,
        onSuccess: (annotations) => {
          if (annotations.length !== 1) {
            return false
          }
          const target = annotations[0].mutators
          return S.is(NamedMutators)(target) &&
            Equal.equals(target.items, [{ name: mutatorName, replacement }]) &&
            Equal.equals(annotations[0].slices, [slice])
        },
      })
    },
  )

  it.prop(
    '∀q_InvalidMutatorQualifier_≡RefusedNamingTheLine',
    { of: [S.Literals(INVALID_QUALIFIER_TEXTS)], subject: parseAnnotations },
    (subject, [mutators]) => {
      const lines = [lineOf(1, `// @stryker-expect next-line Killed: ${mutators}`), lineOf(2, BODY[2])]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) => S.is(AnnotationUnreadable)(failure) && failure.line === 1,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀n_StackedMarkers_≡AllTargetTheFollowingSourceLine',
    {
      of: [S.Literals(STACK_SIZES), S.Literals(STACK_OUTCOME_TEXTS), S.Literals(STACK_OUTCOME_TEXTS), targetArb],
      subject: parseAnnotations,
    },
    (subject, [size, first, second, target]) => {
      const body = lineOf(1 + size, BODY[0])
      const lines = [...stackedLinesOf(stackedTextsOf(size, first, second), target), body]
      const expectedRanges = stackedRangesOf(stackedTextsOf(size, first, second), body)
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: () => false,
        onSuccess: (annotations) => Equal.equals(annotations.map((annotation) => annotation.range), expectedRanges),
      })
    },
  )

  it.prop(
    '∀d_StackedMarkersAboveDeclaration_≡DeclarationCoversTheBody',
    { of: [Outcome, Outcome, targetArb], subject: parseAnnotations },
    (subject, [first, second, target]) => {
      const lines = [
        lineOf(1, markerTextOf('Declaration', first, target, [])),
        lineOf(2, markerTextOf('Line', second, target, [])),
        lineOf(3, BODY[0]),
        lineOf(4, BODY[2]),
      ]
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: () => false,
        onSuccess: (annotations) =>
          Equal.equals(annotations.map((annotation) => annotation.range), [
            { start: { line: 3, column: 1 }, end: { line: 4, column: 2 } },
            rangeOnLine(lines[2]),
          ]),
      })
    },
  )

  it.prop(
    '∀a_MarkerStackAtEof_≡RefusedAsUnresolved',
    {
      of: [S.Literals(STACK_SIZES), S.Literals(STACK_OUTCOME_TEXTS), S.Literals(STACK_OUTCOME_TEXTS), targetArb],
      subject: parseAnnotations,
    },
    (subject, [size, first, second, target]) => {
      const lines = stackedLinesOf(stackedTextsOf(size, first, second), target)
      return Result.match(subject(ParseAnnotationsCommand.make({ file: FILE, lines })), {
        onFailure: (failure) => S.is(AnnotationRangeUnresolved)(failure) && failure.line === 1,
        onSuccess: () => false,
      })
    },
  )
})
