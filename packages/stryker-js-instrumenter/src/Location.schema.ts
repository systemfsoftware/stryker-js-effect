/// <reference types="vitest/importMeta" />
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

export const PositionSchema = S.Struct({
  line: S.Finite,
  column: S.Finite,
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

const endOfMatch = (match: RegExpMatchArray): number =>
  (match.index ?? 0) + match[0].length

const canonicalTextOf = (table: LineStarts): string =>
  Boolean.match(table.lineStarts.length === 1, {
    onTrue: () => '',
    onFalse: () =>
      `${Arr.zip(table.lineStarts.slice(0, -1), table.lineStarts.slice(1))
        .map(([start, next]) => ' '.repeat(next - start - 1))
        .join('\n')}\n`,
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
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const FRAGMENTS = S.Literals(['\r\n', '\r', '\n', '\u2028', '\u2029', 'a', ''])

  const textArbitrary = Arbitrary.map(
    Arbitrary.array(Arbitrary.schema(FRAGMENTS)),
    (fragments) => fragments.join(''),
  )

  const offsetIn = (text: string) =>
    Arbitrary.map(
      Arbitrary.schema(Schema.Int),
      (draw) => ((draw % (text.length + 1)) + text.length + 1) % (text.length + 1),
    )

  const textWithOffset = Arbitrary.flatMap(textArbitrary, (text) =>
    Arbitrary.map(offsetIn(text), (offset) => ({ text, offset })))

  const comparePositions = (a: Position, b: Position): number => {
    const lineDelta = a.line - b.line
    return Boolean.match(lineDelta !== 0, {
      onTrue: () => lineDelta,
      onFalse: () => a.column - b.column,
    })
  }
  const positionStartsItsLine = (table: LineTable, position: Position, offset: number): boolean =>
    Arr.get(table.lineStarts, position.line - 1).pipe(
      Option.exists((start) => start + position.column - 1 === offset),
    )

  const terminatorEndsAtOrBefore = (text: string, offset: number): number =>
    [...text.matchAll(LINE_TERMINATOR)].filter((match) => endOfMatch(match) <= offset).length

  const conservedAt = (text: string, offset: number) =>
    Effect.map(
      S.decodeEffect(LineTableFromText)(text),
      (table) => {
        const position = table.positionAt(offset)
        return [
          positionStartsItsLine(table, position, offset),
          position.column >= 1,
          position.line - 1 === terminatorEndsAtOrBefore(text, offset),
        ].every((condition) => condition)
      },
    )

  it.effect.prop(
    '∀to_Offset→Position≡Model∧ConservesOffset',
    [textWithOffset],
    ([{ text, offset }]) => conservedAt(text, offset).pipe(Effect.orDie),
  )

  const crlfCountsOneLine = (fragments: ReadonlyArray<string>) =>
    Effect.gen(function*() {
      const text = fragments.join('')
      const table = yield* S.decodeEffect(LineTableFromText)(text)
      const sameLengthUnixEndings = yield* S.decodeEffect(LineTableFromText)(text.replaceAll('\r\n', ' \n'))
      return table.lineStarts.join(',') === sameLengthUnixEndings.lineStarts.join(',')
    })

  it.effect.prop(
    '∀t_CRLF_CountsOneLine',
    [Arbitrary.array(Arbitrary.schema(FRAGMENTS))],
    ([fragments]) => crlfCountsOneLine(fragments).pipe(Effect.orDie),
  )

  const lineStartsRiseFromZero = (text: string) =>
    Effect.map(
      S.decodeEffect(LineTableFromText)(text),
      (table) =>
        Option.getOrElse(Arr.head(table.lineStarts), () => -1) === 0 &&
        table.lineStarts.every((start, index) => index === 0 || start > positionLineStartAt(table, index)),
    )
  const positionLineStartAt = (table: LineTable, index: number): number =>
    Option.getOrElse(Arr.get(table.lineStarts, index), () => 0)

  it.effect.prop(
    '∀t_LineStarts_StrictlyRisingFromZero',
    [textArbitrary],
    ([text]) => lineStartsRiseFromZero(text).pipe(Effect.orDie),
  )

  const locationStartsBeforeItEnds = (text: string, offset: number, draw: number) =>
    Effect.gen(function*() {
      const table = yield* S.decodeEffect(LineTableFromText)(text)
      const limit = text.length
      const first = ((draw % (limit + 1)) + limit + 1) % (limit + 1)
      const sorted = [first, offset].sort((left, right) => left - right)
      const location = table.locationAt({
        start: Option.getOrElse(Arr.get(sorted, 0), () => first),
        end: Option.getOrElse(Arr.get(sorted, 1), () => offset),
      })
      return comparePositions(location.start, location.end) <= 0
    })

  it.effect.prop(
    '∀st_Location_Start≤End',
    [textWithOffset, Schema.Int],
    ([{ text, offset }, draw]) => locationStartsBeforeItEnds(text, offset, draw).pipe(Effect.orDie),
  )
}
