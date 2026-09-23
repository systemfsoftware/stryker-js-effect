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
