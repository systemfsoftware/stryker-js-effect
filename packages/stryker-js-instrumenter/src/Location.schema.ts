/// <reference types="vitest/importMeta" />
import type * as Arr from 'effect/Array'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'

export const Offset = S.Int.check(S.isGreaterThanOrEqualTo(0))
export type Offset = typeof Offset.Type

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

export const ScriptOrigin = S.Struct({ line: Mutant.Line, columnShift: Offset })
export type ScriptOrigin = typeof ScriptOrigin.Type

export type LineStarts = Arr.NonEmptyReadonlyArray<Offset>

const accepts = {
  offset: S.is(Offset),
  span: S.is(Span),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = [-1, 0, 1, Number.MAX_SAFE_INTEGER]
  const withSeeds = (drawn: number): ReadonlyArray<number> => Arr.append(seeds, drawn)
  const atLeast = (minimum: number) => (n: number): boolean => Number.isSafeInteger(n) && n >= minimum

  it.prop(
    '∀n_OffsetRefusal_≡NonNegative',
    { of: [S.Int], subject: accepts },
    (subject, [drawn]) => Arr.every(withSeeds(drawn), (n) => subject.offset(n) === atLeast(0)(n)),
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
