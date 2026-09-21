import { describe, it } from '@effect/vitest'
import {
  HIT_LIMIT_REASON_PREFIX,
  hitLimitReachedReason,
  WALL_CLOCK_TIMEOUT_REASON,
  wallClockTimeoutStopsRun,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

describe('wallClockTimeoutStopsRun', () => {
  it.prop(
    '∀_BareOrWallClockTimeout_StopsAndDoesNotRecord',
    [Arbitrary.schema(S.Literals(['', WALL_CLOCK_TIMEOUT_REASON]))],
    ([reason]) => {
      const presented = reason.length === 0 ? undefined : reason
      return wallClockTimeoutStopsRun('timeout', presented) === true
    },
  )

  it.prop(
    '∀n_HitLimitTimeout_IsRecorded',
    [
      Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 1000 }))),
      Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 100 }))),
    ],
    ([extra, limit]) => {
      const reason = hitLimitReachedReason(limit + extra, limit)
      return reason.startsWith(HIT_LIMIT_REASON_PREFIX) && wallClockTimeoutStopsRun('timeout', reason) === false
    },
  )

  it.prop(
    '∀s_NonTimeout_DoesNotStop',
    [Arbitrary.schema(S.Literals(['killed', 'survived', 'error']))],
    ([status]) => wallClockTimeoutStopsRun(status, WALL_CLOCK_TIMEOUT_REASON) === false,
  )
})
