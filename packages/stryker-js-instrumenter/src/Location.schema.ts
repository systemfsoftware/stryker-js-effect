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

const lineStartsOf = (text: string): { readonly lineStarts: [number, ...Array<number>] } => ({
  lineStarts: [
    0,
    ...[...text.matchAll(LINE_TERMINATOR)].map((match) => match.index + match[0].length),
  ],
})

const canonicalTextOf = (table: LineTable): string =>
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
      onFalse: () => {
        const middle = middleIndex(low, high)
        return Match.value(lineStarts[middle]).pipe(
          Match.when((mid) => mid === offset, (mid) => ({ line: middle, column: offset - mid })),
          Match.when((mid) => mid < offset, (mid) => search(middle + 1, high, mid)),
          Match.orElse(() => search(low, middle - 1, start)),
        )
      },
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

  const terminatorEndsAtOrBefore = (text: string, offset: number): number =>
    [...text.matchAll(LINE_TERMINATOR)].filter((match) => match.index + match[0].length <= offset).length

  it.effect.prop(
    '∀to_Offset→Position≡Model∧ConservesOffset',
    [textWithOffset],
    ({ text, offset }) =>
      Effect.gen(function*() {
        const table = yield* Effect.orDie(S.decode(LineTableFromText)(text))
        const position = table.positionAt(offset)
        const startOfLine = Arr.get(table.lineStarts, position.line - 1)
        return Option.isSome(startOfLine) &&
          startOfLine.value + position.column - 1 === offset &&
          position.column >= 1 &&
          position.line - 1 === terminatorEndsAtOrBefore(text, offset)
      }),
  )

  it.effect.prop(
    '∀t_CRLF_CountsOneLine',
    [Arbitrary.array(Arbitrary.schema(FRAGMENTS))],
    (fragments) =>
      Effect.gen(function*() {
        const text = fragments.join('')
        const table = yield* Effect.orDie(S.decode(LineTableFromText)(text))
        const withUnixEndings = yield* Effect.orDie(S.decode(LineTableFromText)(text.replaceAll('\r\n', '\n')))
        return table.lineStarts.join(',') === withUnixEndings.lineStarts.join(',')
      }),
  )

  it.effect.prop(
    '∀t_LineStarts_StrictlyRisingFromZero',
    [textArbitrary],
    (text) =>
      Effect.map(
        Effect.orDie(S.decode(LineTableFromText)(text)),
        (table) =>
          table.lineStarts[0] === 0 &&
          table.lineStarts.every((start, index) => index === 0 || start > table.lineStarts[index - 1]),
      ),
  )

  it.effect.prop(
    '∀st_Location_Start≤End',
    [textWithOffset, Schema.Int],
    ({ text, offset }, draw) =>
      Effect.gen(function*() {
        const table = yield* Effect.orDie(S.decode(LineTableFromText)(text))
        const limit = text.length
        const first = ((draw % (limit + 1)) + limit + 1) % (limit + 1)
        const [start, end] = [first, offset].sort((left, right) => left - right)
        const location = table.locationAt({ start, end })
        return comparePositions(location.start, location.end) <= 0
      }),
  )
}
