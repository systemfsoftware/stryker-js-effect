import * as S from 'effect/Schema'

const LegClockTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-bench/LegClock')
type LegClockTypeId = typeof LegClockTypeId

export class LegElapsed extends S.TaggedClass<LegElapsed>()('LegElapsed', {
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

export class LegClockBehind extends S.TaggedClass<LegClockBehind>()('LegClockBehind', {}) {
  readonly [LegClockTypeId] = LegClockTypeId
}

export const LegClock = S.Union([LegElapsed, LegClockBehind])
export type LegClock = typeof LegClock.Type
