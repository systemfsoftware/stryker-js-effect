import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const LegClockTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-bench/LegClock')
type LegClockTypeId = typeof LegClockTypeId

export class LegElapsed extends S.TaggedClass<LegElapsed, { readonly brand: unique symbol }>()('LegElapsed', {
  wallMs: S.Finite.pipe(
    S.check(
      S.isGreaterThanOrEqualTo(0, {
        message: "a leg's elapsed wall time is a finite number of milliseconds, never negative",
      }),
    ),
  ),
}) {
  readonly [LegClockTypeId] = LegClockTypeId
}

export class LegClockBehind
  extends S.TaggedClass<LegClockBehind, { readonly brand: unique symbol }>()('LegClockBehind', {})
{
  readonly [LegClockTypeId] = LegClockTypeId
}

export const LegClock = S.Union([LegElapsed, LegClockBehind])
export type LegClock = typeof LegClock.Type

const acceptsElapsedMs = (wallMs: number): boolean =>
  Result.isSuccess(S.decodeResult(LegElapsed)({ _tag: 'LegElapsed', wallMs }))

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const boundaryValues = [
    -1,
    -Number.MIN_VALUE,
    -0,
    0,
    Number.MIN_VALUE,
    600_000,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  const isElapsedTime = (ms: number): boolean => Number.isFinite(ms) && ms >= 0

  it.prop(
    '∀n_LegElapsedRefusal_≡FiniteAndNotNegative',
    { of: [S.Finite], subject: acceptsElapsedMs },
    (subject, [drawn]) => Arr.every(Arr.append(boundaryValues, drawn), (ms) => subject(ms) === isElapsedTime(ms)),
  )
}
