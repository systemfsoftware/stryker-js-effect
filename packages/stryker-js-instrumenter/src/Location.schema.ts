/// <reference types="vitest/importMeta" />
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

/**
 * File coordinates in the mutation-testing-report-schema contract: both line
 * and column are 1-based. The first line of a file is line 1, and the first
 * character of a line is column 1. Slicing a source line by one of these
 * positions uses `line - 1` for the line index and `column - 1` for the
 * character offset.
 */
export const PositionSchema = S.Struct({
  line: S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
  column: S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
})
export type Position = typeof PositionSchema.Type

export const LocationSchema = S.Struct({
  start: PositionSchema,
  end: PositionSchema,
})
export type Location = typeof LocationSchema.Type

export const OpenEndLocationSchema = S.Struct({
  start: PositionSchema,
  end: S.optional(PositionSchema),
})
export type OpenEndLocation = typeof OpenEndLocationSchema.Type

/**
 * A mutant's `location` already speaks the report contract (1-based line and
 * column), so the report's location is that location unchanged.
 */
export const ReportLocationFromMutant = LocationSchema

const NonNegativeInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))

export class LineTable extends S.Class<LineTable>('LineTable')({
  lineStarts: S.NonEmptyArray(NonNegativeInt),
}) {
  positionAt(offset: number): Position {
    return positionOf(this.lineStarts, offset)
  }

  locationAt(span: { readonly start: number; readonly end: number }): Location {
    return { start: this.positionAt(span.start), end: this.positionAt(span.end) }
  }

  zeroBasedPositionAt(offset: number): Position {
    return zeroBasedPositionOf(this.lineStarts, offset)
  }
}

const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/g

interface LineStarts {
  readonly lineStarts: readonly [number, ...Array<number>]
}

const lineStartsOf = (text: string): LineStarts => ({
  lineStarts: [0, ...[...text.matchAll(LINE_TERMINATOR)].map((match) => endOfMatch(match))],
})

const endOfMatch = (match: RegExpMatchArray): number => (match.index ?? 0) + match[0].length

const canonicalTextOf = (table: LineStarts): string =>
  Boolean.match(table.lineStarts.length === 1, {
    onTrue: () => '',
    onFalse: () =>
      `${
        Arr.zip(table.lineStarts.slice(0, -1), table.lineStarts.slice(1))
          .map(([start, next]) => ' '.repeat(next - start - 1))
          .join('\n')
      }\n`,
  })

export const LineTableFromText = S.String.pipe(
  S.decodeTo(LineTable, {
    decode: SGetter.transform(lineStartsOf),
    encode: SGetter.transform(canonicalTextOf),
  }),
)

const middleIndex = (low: number, high: number): number => low + ((high - low) >> 1)

const zeroBasedPositionOf = (lineStarts: Arr.NonEmptyReadonlyArray<number>, offset: number): Position => {
  const search = (low: number, high: number, start: number): Position =>
    Boolean.match(low > high, {
      onTrue: () => ({ line: low - 1, column: offset - start }),
      onFalse: () =>
        Option.match(Arr.get(lineStarts, middleIndex(low, high)), {
          onNone: () => ({ line: low - 1, column: offset - start }),
          onSome: (found) =>
            Boolean.match(found === offset, {
              onTrue: () => ({ line: middleIndex(low, high), column: offset - found }),
              onFalse: () =>
                Boolean.match(found < offset, {
                  onTrue: () => search(middleIndex(low, high) + 1, high, found),
                  onFalse: () => search(low, middleIndex(low, high) - 1, start),
                }),
            }),
        }),
    })
  return search(0, lineStarts.length - 1, 0)
}

const positionOf = (lineStarts: Arr.NonEmptyReadonlyArray<number>, offset: number): Position => {
  const zeroBased = zeroBasedPositionOf(lineStarts, offset)
  return { line: zeroBased.line + 1, column: zeroBased.column + 1 }
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Schema } = await import('effect')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const SegmentSchema = Schema.Struct({
    content: Schema.String,
    terminator: Schema.Literals(['\r\n', '\r', '\n', '\u2028', '\u2029']),
  })

  const textArbitrary = Arbitrary.map(
    Arbitrary.array(Arbitrary.schema(SegmentSchema)),
    (segments) => segments.map((segment) => `${segment.content}${segment.terminator}`).join(''),
  )

  const offsetWithin = (text: string, draw: number): number =>
    ((draw % (text.length + 1)) + text.length + 1) % (text.length + 1)

  const textWithOffset = Arbitrary.flatMap(
    textArbitrary,
    (text) => Arbitrary.map(Arbitrary.schema(Schema.Int), (draw) => ({ text, offset: offsetWithin(text, draw) })),
  )

  const terminatorEndsOf = (text: string): ReadonlyArray<number> => {
    const endsAfter = (offset: number): ReadonlyArray<number> =>
      Boolean.match(offset >= text.length, {
        onTrue: () => [],
        onFalse: () => {
          const isCrLf = text.startsWith('\r\n', offset)
          const width = Boolean.match(isCrLf, { onTrue: () => 2, onFalse: () => 1 })
          const ends = Boolean.match(isCrLf || '\n\r\u2028\u2029'.includes(text.charAt(offset)), {
            onTrue: () => [offset + width],
            onFalse: () => [],
          })
          return [...ends, ...endsAfter(offset + width)]
        },
      })
    return [0, ...endsAfter(0)]
  }

  const comparePositions = (a: Position, b: Position): number => {
    const lineDelta = a.line - b.line
    return lineDelta !== 0 ? lineDelta : a.column - b.column
  }

  it.prop(
    '∀text_LineStarts_=TerminatorEnds',
    { of: [textArbitrary], subject: lineStartsOf },
    (subject, [text]) => subject(text).lineStarts.join(',') === terminatorEndsOf(text).join(','),
  )

  it.prop(
    '∀text_CrlfLines_=UnixLines',
    { of: [textArbitrary], subject: lineStartsOf },
    (subject, [text]) =>
      subject(text).lineStarts.join(',') === subject(text.replaceAll('\r\n', ' \n')).lineStarts.join(','),
  )

  it.prop(
    '∀sample_Position_≡ConservesOffset',
    { of: [textWithOffset], subject: zeroBasedPositionOf },
    (subject, [{ text, offset }]) => {
      const lineStarts = lineStartsOf(text).lineStarts
      const position = subject(lineStarts, offset)
      const start = Option.fromUndefinedOr(lineStarts[position.line])
      const next = Option.fromUndefinedOr(lineStarts[position.line + 1])
      return Option.match(start, {
        onNone: () => false,
        onSome: (lineStart) =>
          Arr.every(
            [
              lineStart + position.column === offset,
              position.column >= 0,
              Option.match(next, { onNone: () => true, onSome: (nextStart) => nextStart > offset }),
            ],
            (verdict) => verdict,
          ),
      })
    },
  )

  it.prop(
    '∀span_Position_≤End',
    { of: [textWithOffset, Schema.Int], subject: zeroBasedPositionOf },
    (subject, [{ text, offset }, draw]) => {
      const lineStarts = lineStartsOf(text).lineStarts
      const low = Math.min(offsetWithin(text, draw), offset)
      const high = Math.max(offsetWithin(text, draw), offset)
      return comparePositions(subject(lineStarts, low), subject(lineStarts, high)) <= 0
    },
  )
}
