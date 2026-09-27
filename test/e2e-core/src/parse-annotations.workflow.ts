import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  Annotation,
  AnnotationMarker,
  AnnotationParseFailure,
  AnnotationRangeUnresolved,
  AnnotationStatusOutcome,
  AnnotationUnreadable,
  KilledOrTimeoutOutcome,
  Outcome,
  type Scope,
  SourceLine,
} from './annotation.schema.js'

export class ParseAnnotationsCommand extends S.TaggedClass<ParseAnnotationsCommand>()('ParseAnnotationsCommand', {
  file: S.String,
  lines: S.Array(SourceLine),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MARKER_LINE = new RegExp(`^\\s*//\\s*${AnnotationMarker.literal}\\s*(.*)$`)
const SLICE_QUALIFIER = /^(.*?)\s*\[([^\]]*)\]\s*$/
const COLON_SPLIT = /^([^:]*):([\s\S]*)$/
const SCOPED_HEAD = /^(?:(\S+)\s+)?(\S+)$/
const OUTCOME_CALL = /^(CompileError|RuntimeError)\(([^)]*)\)$/

const SCOPES: Readonly<Record<string, Scope>> = { 'next-line': 'Line', file: 'File' }
const DEFAULT_SCOPE: Scope = 'Declaration'
const KILLED_OR_TIMEOUT = 'KilledOrTimeout'
const ALL_MUTATORS = 'all'
const BARE_ERROR = 'Error'
const BARE_ERROR_REASON = 'the bare name "Error" names no error class; name the thrown class'

const IsStatus = S.is(Mutant.MutantStatusSchema)
const StatusOutcome = AnnotationStatusOutcome
const KilledOrTimeout = KilledOrTimeoutOutcome
const DecodeOutcome = S.decodeResult(Outcome)
const DecodeAnnotation = S.decodeResult(Annotation)
const RefuseUnreadable = AnnotationUnreadable
const RefuseRange = AnnotationRangeUnresolved

interface MarkerLine {
  readonly number: number
  readonly text: string
  readonly rest: string
}

interface Sections {
  readonly scopeAndOutcome: string
  readonly mutators: string
  readonly slices: Option.Option<ReadonlyArray<string>>
}

interface ScopedOutcome {
  readonly scope: Scope
  readonly outcomeText: string
}

const EncodedCauseBase = S.Union([
  S.TaggedStruct('CompileError', { code: S.String }),
  S.TaggedStruct('RuntimeError', { errorClass: S.String }),
])

const EncodedTargetBase = S.Union([
  S.TaggedStruct('All', {}),
  S.TaggedStruct('Named', { names: S.Array(S.String) }),
])

type EncodedCause = S.Schema.Type<typeof EncodedCauseBase>

type EncodedTarget = S.Schema.Type<typeof EncodedTargetBase>

type NonEmptyList = readonly [string, ...Array<string>]

const markerLineOf = (line: SourceLine): Option.Option<MarkerLine> =>
  Option.map(Option.fromNullishOr(MARKER_LINE.exec(line.text)), (match) => ({
    number: line.number,
    text: line.text,
    rest: match[1].trim(),
  }))

const commaSeparated = (text: string): ReadonlyArray<string> =>
  text.split(',').map((part) => part.trim()).filter((part) => part.length > 0)

const colonPartsOf = (text: string): Option.Option<{ scopeAndOutcome: string; mutators: string }> =>
  Option.map(Option.fromNullishOr(COLON_SPLIT.exec(text)), (match) => ({
    scopeAndOutcome: match[1].trim(),
    mutators: match[2].trim(),
  }))

const sectionsOf = (text: string): Option.Option<Sections> =>
  Option.match(Option.fromNullishOr(SLICE_QUALIFIER.exec(text)), {
    onNone: () => Option.map(colonPartsOf(text), (parts) => ({ ...parts, slices: Option.none() })),
    onSome: (match) =>
      Option.map(colonPartsOf(match[1]), (parts) => ({ ...parts, slices: Option.some(commaSeparated(match[2])) })),
  })

const scopeOf = (token: string | undefined): Option.Option<Scope> =>
  Option.match(Option.fromUndefinedOr(token), {
    onNone: () => Option.some(DEFAULT_SCOPE),
    onSome: (value) => Option.fromNullishOr(SCOPES[value]),
  })

const scopeAndOutcomeOf = (text: string): Option.Option<ScopedOutcome> =>
  Option.flatMap(
    Option.fromNullishOr(SCOPED_HEAD.exec(text)),
    (match) => Option.map(scopeOf(match[1]), (scope) => ({ scope, outcomeText: match[2] })),
  )

const statusOutcomeOf = (text: string): Option.Option<Outcome> =>
  Option.map(Option.filter(Option.some(text), IsStatus), (status) => StatusOutcome.make({ status }))

const killedOrTimeoutOf = (text: string): Option.Option<Outcome> =>
  Boolean.match(text === KILLED_OR_TIMEOUT, {
    onTrue: () => Option.some(KilledOrTimeout.make({})),
    onFalse: () => Option.none(),
  })

const CAUSE_KINDS: Readonly<Record<string, (argument: string) => EncodedCause>> = {
  CompileError: (code) => ({ _tag: 'CompileError', code }),
  RuntimeError: (errorClass) => ({ _tag: 'RuntimeError', errorClass }),
}

const callOutcomeOf = (text: string): Option.Option<Outcome> =>
  Option.flatMap(
    Option.fromNullishOr(OUTCOME_CALL.exec(text)),
    (match) =>
      Option.flatMap(Option.fromNullishOr(CAUSE_KINDS[match[1]]), (encode) =>
        Result.match(DecodeOutcome(encode(match[2])), {
          onFailure: () =>
            Option.none(),
          onSuccess: (outcome) => Option.some(outcome),
        })),
  )

const outcomeOf = (text: string): Option.Option<Outcome> =>
  Option.firstSomeOf([statusOutcomeOf(text), killedOrTimeoutOf(text), callOutcomeOf(text)])

const nonEmptyList = (values: ReadonlyArray<string>): Option.Option<NonEmptyList> =>
  Option.map(Arr.head(values), (first): NonEmptyList => [first, ...values.slice(1)])

const encodedTargetOf = (text: string): Option.Option<EncodedTarget> =>
  Boolean.match(text === ALL_MUTATORS, {
    onTrue: () => Option.some({ _tag: 'All' }),
    onFalse: () => Option.map(nonEmptyList(commaSeparated(text)), (names) => ({ _tag: 'Named', names: [...names] })),
  })

const encodedSlices = (
  slices: Option.Option<ReadonlyArray<string>>,
): Option.Option<{ readonly slices?: ReadonlyArray<string> }> =>
  Option.match(slices, {
    onNone: () => Option.some({}),
    onSome: (values) => Option.map(nonEmptyList(values), (names) => ({ slices: [...names] })),
  })

const refusesBareError = (outcome: Outcome): boolean =>
  Match.value(outcome).pipe(
    Match.tag('Status', () => false),
    Match.tag('KilledOrTimeout', () => false),
    Match.tag('CompileError', () => false),
    Match.tag('RuntimeError', ({ errorClass }) => errorClass === BARE_ERROR),
    Match.exhaustive,
  )

interface Position {
  readonly line: number
  readonly column: number
}

const positionOf = (line: number, column: number): Position => ({ line, column })

const singleLineRange = (line: SourceLine): Mutant.Location => ({
  start: positionOf(line.number, 1),
  end: positionOf(line.number, line.text.length + 1),
})

const linesAfter = (lines: ReadonlyArray<SourceLine>, number: number): ReadonlyArray<SourceLine> =>
  lines.filter((line) => line.number > number)

const firstNonBlank = (lines: ReadonlyArray<SourceLine>): Option.Option<SourceLine> =>
  Arr.findFirst(lines, (line) => line.text.trim().length > 0)

const lineRange = (lines: ReadonlyArray<SourceLine>, number: number): Option.Option<Mutant.Location> =>
  Option.map(Arr.findFirst(lines, (line) => line.number === number + 1), singleLineRange)

const fileRange = (lines: ReadonlyArray<SourceLine>): Mutant.Location => {
  const last = Option.getOrElse(Arr.last(lines), (): SourceLine => ({ number: 1, text: '' }))
  return { start: { line: 1, column: 1 }, end: positionOf(last.number, last.text.length + 1) }
}

interface BraceScan {
  readonly depth: number
  readonly opened: boolean
  readonly closedAt: Option.Option<Position>
}

const INERT_SCAN: BraceScan = { depth: 0, opened: false, closedAt: Option.none() }

const closingScan = (scan: BraceScan, at: Position): BraceScan => {
  const depth = Boolean.match(scan.depth === 0, { onTrue: () => 0, onFalse: () => scan.depth - 1 })
  return Boolean.match(Boolean.and(depth === 0, scan.opened), {
    onTrue: () => ({ depth, opened: scan.opened, closedAt: Option.some(positionOf(at.line, at.column + 1)) }),
    onFalse: () => ({ depth, opened: scan.opened, closedAt: scan.closedAt }),
  })
}

const steppingScan = (scan: BraceScan, at: Position, char: string): BraceScan =>
  Boolean.match(char === '{', {
    onTrue: () => ({ depth: scan.depth + 1, opened: true, closedAt: Option.none() }),
    onFalse: () =>
      Boolean.match(char === '}', {
        onTrue: () => closingScan(scan, at),
        onFalse: () => scan,
      }),
  })

const scannedLine = (scan: BraceScan, line: SourceLine): BraceScan =>
  line.text.split('').reduce(
    (inner, char, index) => steppingScan(inner, positionOf(line.number, index + 1), char),
    scan,
  )

const scannedLines = (lines: ReadonlyArray<SourceLine>, scan: BraceScan): BraceScan => lines.reduce(scannedLine, scan)

const openingIndex = (text: string): number =>
  Option.getOrElse(Option.filter(Option.some(text.indexOf('{')), (index) => index >= 0), () => 0)

const declarationRange = (lines: ReadonlyArray<SourceLine>, number: number): Option.Option<Mutant.Location> =>
  Option.flatMap(firstNonBlank(linesAfter(lines, number)), (from) =>
    Boolean.match(from.text.includes('{'), {
      onTrue: () =>
        Option.map(
          scannedLines(
            [
              { number: from.number, text: from.text.slice(openingIndex(from.text)) },
              ...linesAfter(lines, from.number),
            ],
            INERT_SCAN,
          ).closedAt,
          (end) => ({ start: positionOf(from.number, 1), end }),
        ),
      onFalse: () => Option.some(singleLineRange(from)),
    }))

const rangeOf = (lines: ReadonlyArray<SourceLine>, number: number, scope: Scope): Option.Option<Mutant.Location> =>
  Match.value(scope).pipe(
    Match.when('Line', () => lineRange(lines, number)),
    Match.when('Declaration', () => declarationRange(lines, number)),
    Match.when('File', () => Option.some(fileRange(lines))),
    Match.exhaustive,
  )

const refuseText = (file: string, marker: MarkerLine, reason: string): AnnotationParseFailure =>
  RefuseUnreadable.make({ file, line: marker.number, text: marker.text, reason })

const refuseRange = (file: string, marker: MarkerLine, reason: string): AnnotationParseFailure =>
  RefuseRange.make({ file, line: marker.number, reason })

const required = <A>(
  option: Option.Option<A>,
  refusal: AnnotationParseFailure,
): Result.Result<A, AnnotationParseFailure> =>
  Option.match(option, {
    onNone: () => Result.fail(refusal),
    onSome: (value) => Result.succeed(value),
  })

const decodedAnnotation = (
  file: string,
  marker: MarkerLine,
  encoded: typeof Annotation.Encoded,
): Result.Result<Annotation, AnnotationParseFailure> =>
  Result.flatMap(
    Result.match(DecodeAnnotation(encoded), {
      onFailure: (issue): Result.Result<Annotation, AnnotationParseFailure> =>
        Result.fail(refuseText(file, marker, issue.message)),
      onSuccess: (annotation): Result.Result<Annotation, AnnotationParseFailure> => Result.succeed(annotation),
    }),
    (annotation) =>
      Boolean.match(refusesBareError(annotation.outcome), {
        onTrue: (): Result.Result<Annotation, AnnotationParseFailure> =>
          Result.fail(refuseText(file, marker, BARE_ERROR_REASON)),
        onFalse: () => Result.succeed(annotation),
      }),
  )

const annotationOf = (
  file: string,
  lines: ReadonlyArray<SourceLine>,
  marker: MarkerLine,
): Result.Result<Annotation, AnnotationParseFailure> =>
  Result.flatMap(
    required(sectionsOf(marker.rest), refuseText(file, marker, 'expected "<outcome>: <mutators>"')),
    (sections) =>
      Result.flatMap(
        required(
          encodedTargetOf(sections.mutators),
          refuseText(file, marker, 'expected "all" or at least one mutator name after the outcome'),
        ),
        (mutators) =>
          Result.flatMap(
            required(
              encodedSlices(sections.slices),
              refuseText(file, marker, 'expected at least one slice config name inside the brackets'),
            ),
            (slices) =>
              Result.flatMap(
                required(
                  scopeAndOutcomeOf(sections.scopeAndOutcome),
                  refuseText(file, marker, `expected an outcome, received "${sections.scopeAndOutcome}"`),
                ),
                (scoped) =>
                  Result.flatMap(
                    required(
                      outcomeOf(scoped.outcomeText),
                      refuseText(file, marker, `unknown outcome "${scoped.outcomeText}"`),
                    ),
                    (outcome) =>
                      Result.flatMap(
                        required(
                          rangeOf(lines, marker.number, scoped.scope),
                          refuseRange(file, marker, `${scoped.scope} scope resolves to no range after this line`),
                        ),
                        (range) =>
                          decodedAnnotation(file, marker, {
                            _tag: 'Annotation',
                            line: marker.number,
                            scope: scoped.scope,
                            range,
                            outcome,
                            mutators,
                            ...slices,
                          }),
                      ),
                  ),
              ),
          ),
      ),
  )

const annotationsOn = (
  file: string,
  lines: ReadonlyArray<SourceLine>,
  line: SourceLine,
): Result.Result<Option.Option<Annotation>, AnnotationParseFailure> =>
  Option.match(markerLineOf(line), {
    onNone: () => Result.succeed(Option.none()),
    onSome: (marker) => Result.map(annotationOf(file, lines, marker), Option.some),
  })

const decide = (
  command: ParseAnnotationsCommand,
): Result.Result<ReadonlyArray<Annotation>, AnnotationParseFailure> =>
  command.lines.reduce<Result.Result<ReadonlyArray<Annotation>, AnnotationParseFailure>>(
    (accumulated, line) =>
      Result.flatMap(
        accumulated,
        (annotations) =>
          Result.map(annotationsOn(command.file, command.lines, line), (parsed) =>
            Option.match(parsed, {
              onNone: () => annotations,
              onSome: (annotation) => [...annotations, annotation],
            })),
      ),
    Result.succeed([]),
  )

export const parseAnnotations = Workflow.make({
  command: ParseAnnotationsCommand,
  decision: S.Array(Annotation),
  error: AnnotationParseFailure,
  decide,
})
