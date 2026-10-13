import * as S from 'effect/Schema'

const LegClockTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-bench/LegClock')
type LegClockTypeId = typeof LegClockTypeId

export class LegElapsed extends S.TaggedClass<LegElapsed>()('LegElapsed', { wallMs: S.Finite }) {
  readonly [LegClockTypeId] = LegClockTypeId
}

export class LegClockBehind extends S.TaggedClass<LegClockBehind>()('LegClockBehind', {}) {
  readonly [LegClockTypeId] = LegClockTypeId
}

export const LegClock = S.Union([LegElapsed, LegClockBehind])
export type LegClock = typeof LegClock.Type
