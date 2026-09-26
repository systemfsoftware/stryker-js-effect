/// <reference types="vitest/importMeta" />
import type * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

export const Offset = S.Int.check(S.isGreaterThanOrEqualTo(0))
export type Offset = typeof Offset.Type

/** A 1-based line: the first line of a file is line 1. */
export const Line = S.Int.check(S.isGreaterThanOrEqualTo(1))
export type Line = typeof Line.Type

/** A 1-based column: the first character of a line is column 1. */
export const Column = S.Int.check(S.isGreaterThanOrEqualTo(1))
export type Column = typeof Column.Type

export const Position = S.Struct({ line: Line, column: Column })
export type Position = typeof Position.Type

const positionOrder = Order.combine(
  Order.mapInput(Order.Number, (position: Position) => position.line),
  Order.mapInput(Order.Number, (position: Position) => position.column),
)

interface Ends<A> {
  readonly start: A
  readonly end: A
}

const inOrder = <A>(order: Order.Order<A>) => (ends: Ends<A>): Ends<A> => ({
  start: Order.min(order)(ends.start, ends.end),
  end: Order.max(order)(ends.start, ends.end),
})

const notReversed = <A>(order: Order.Order<A>) => (ends: Ends<A>): boolean =>
  Order.isLessThanOrEqualTo(order)(ends.start, ends.end)

const PositionEnds = S.Struct({ start: Position, end: Position })
type PositionEnds = typeof PositionEnds.Type

export const Location = S.declare(
  (value: unknown): value is PositionEnds => S.is(PositionEnds)(value) && notReversed(positionOrder)(value),
  {
    expected: 'a location whose end is not before its start',
    toCodecArbitrary: () =>
      S.link<PositionEnds>()(PositionEnds, {
        decode: SchemaGetter.transform(inOrder(positionOrder)),
        encode: SchemaGetter.transform((ends: PositionEnds) => ends),
      }),
  },
)
export type Location = typeof Location.Type

const OpenEnds = S.Struct({ start: Position, end: S.optional(Position) })
type OpenEnds = typeof OpenEnds.Type

const closedEnds = (ends: OpenEnds): Option.Option<PositionEnds> =>
  Option.map(Option.fromUndefinedOr(ends.end), (end) => ({ start: ends.start, end }))

export const OpenEndLocation = S.declare(
  (value: unknown): value is OpenEnds =>
    S.is(OpenEnds)(value) &&
    Option.match(closedEnds(value), { onNone: () => true, onSome: notReversed(positionOrder) }),
  {
    expected: 'a location whose end, when present, is not before its start',
    toCodecArbitrary: () =>
      S.link<OpenEnds>()(OpenEnds, {
        decode: SchemaGetter.transform((ends: OpenEnds) =>
          Option.getOrElse(Option.map(closedEnds(ends), inOrder(positionOrder)), () => ends)
        ),
        encode: SchemaGetter.transform((ends: OpenEnds) => ends),
      }),
  },
)
export type OpenEndLocation = typeof OpenEndLocation.Type

const OffsetEnds = S.Struct({ start: Offset, end: Offset })
type OffsetEnds = typeof OffsetEnds.Type

export const Span = S.declare(
  (value: unknown): value is OffsetEnds => S.is(OffsetEnds)(value) && notReversed(Order.Number)(value),
  {
    expected: 'a span whose end is not before its start',
    toCodecArbitrary: () =>
      S.link<OffsetEnds>()(OffsetEnds, {
        decode: SchemaGetter.transform(inOrder(Order.Number)),
        encode: SchemaGetter.transform((ends: OffsetEnds) => ends),
      }),
  },
)
export type Span = typeof Span.Type

export const ScriptOrigin = S.Struct({ line: Line, columnShift: Offset })
export type ScriptOrigin = typeof ScriptOrigin.Type

export type LineStarts = Arr.NonEmptyReadonlyArray<Offset>

const accepts = {
  offset: S.is(Offset),
  line: S.is(Line),
  column: S.is(Column),
  location: S.is(Location),
  span: S.is(Span),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = [-1, 0, 1, Number.MAX_SAFE_INTEGER]
  const withSeeds = (drawn: number): ReadonlyArray<number> => Arr.append(seeds, drawn)
  const atLeast = (minimum: number) => (n: number): boolean => Number.isSafeInteger(n) && n >= minimum
  const lexicographic = Order.isLessThanOrEqualTo(Order.Tuple([Order.Number, Order.Number]))

  it.prop(
    '∀n_CoordinateRefusal_≡Bounds',
    { of: [S.Int], subject: accepts },
    (subject, [drawn]) =>
      Arr.every(withSeeds(drawn), (n) =>
        Arr.every(
          [
            subject.offset(n) === atLeast(0)(n),
            subject.line(n) === atLeast(1)(n),
            subject.column(n) === atLeast(1)(n),
          ],
          (agrees) => agrees,
        )),
  )

  it.prop(
    '∀p_LocationRefusal_≡EndNotBeforeStart',
    { of: [S.Int, S.Int, S.Int, S.Int], subject: accepts },
    (subject, [startLine, startColumn, endLine, drawnEndColumn]) =>
      Arr.every(withSeeds(drawnEndColumn), (endColumn) =>
        subject.location({
          start: { line: startLine, column: startColumn },
          end: { line: endLine, column: endColumn },
        }) ===
          (Arr.every([startLine, startColumn, endLine, endColumn], atLeast(1)) &&
            lexicographic([startLine, startColumn], [endLine, endColumn]))),
  )

  it.prop(
    '∀s_SpanRefusal_≡EndNotBeforeStart',
    { of: [S.Int, S.Int], subject: accepts },
    (subject, [start, drawnEnd]) =>
      Arr.every(
        withSeeds(drawnEnd),
        (end) => subject.span({ start, end }) === (Arr.every([start, end], atLeast(0)) && start <= end),
      ),
  )
}
