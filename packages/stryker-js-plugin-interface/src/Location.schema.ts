/// <reference types="vitest/importMeta" />
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaTransformation from 'effect/SchemaTransformation'

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

export interface Ends<A> {
  readonly start: A
  readonly end: A
}

export const inOrder = <A>(order: Order.Order<A>): (ends: Ends<A>) => Ends<A> => (ends: Ends<A>): Ends<A> => ({
  start: Order.min(order)(ends.start, ends.end),
  end: Order.max(order)(ends.start, ends.end),
})

export const notReversed = <A>(order: Order.Order<A>): (ends: Ends<A>) => boolean => (ends: Ends<A>): boolean =>
  Order.isLessThanOrEqualTo(order)(ends.start, ends.end)

const PositionEndsSchema = S.Struct({ start: Position, end: Position })
type PositionEnds = typeof PositionEndsSchema.Type

const OrderedEnds = S.declare(
  (value: unknown): value is PositionEnds => S.is(PositionEndsSchema)(value) && notReversed(positionOrder)(value),
  {
    expected: 'a location whose end is not before its start',
    toCodecArbitrary: () =>
      S.link<PositionEnds>()(PositionEndsSchema, {
        decode: SchemaGetter.transform(inOrder(positionOrder)),
        encode: SchemaGetter.transform((ends: PositionEnds) => ends),
      }),
  },
)

export const Location = PositionEndsSchema.pipe(S.decodeTo(OrderedEnds, SchemaTransformation.passthrough()))
export type Location = typeof Location.Type

const OpenEndsSchema = S.Struct({ start: Position, end: S.optional(Position) })
type OpenEnds = typeof OpenEndsSchema.Type

const closedEnds = (ends: OpenEnds): Option.Option<PositionEnds> =>
  Option.map(Option.fromUndefinedOr(ends.end), (end) => ({ start: ends.start, end }))

const OrderedOpenEnds = S.declare(
  (value: unknown): value is OpenEnds =>
    S.is(OpenEndsSchema)(value) &&
    Option.match(closedEnds(value), { onNone: () => true, onSome: notReversed(positionOrder) }),
  {
    expected: 'a location whose end, when present, is not before its start',
    toCodecArbitrary: () =>
      S.link<OpenEnds>()(OpenEndsSchema, {
        decode: SchemaGetter.transform((ends: OpenEnds) =>
          Option.getOrElse(Option.map(closedEnds(ends), inOrder(positionOrder)), () => ends)
        ),
        encode: SchemaGetter.transform((ends: OpenEnds) => ends),
      }),
  },
)

export const OpenEndLocation = OpenEndsSchema.pipe(S.decodeTo(OrderedOpenEnds, SchemaTransformation.passthrough()))
export type OpenEndLocation = typeof OpenEndLocation.Type

const accepts = {
  line: S.is(Line),
  column: S.is(Column),
  location: S.is(Location),
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
          [subject.line(n) === atLeast(1)(n), subject.column(n) === atLeast(1)(n)],
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
}
