import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { LegClockBehind, LegElapsed } from '../leg-clock.schema.js'
import { measureLeg, MeasureLegCommand } from '../measure-leg.workflow.js'

describe('measureLeg', () => {
  it.prop(
    '∀sd_ClockAtOrPastTheMark_≡MeasuredFromTheMarkInMilliseconds',
    { of: [S.Int, S.Int], subject: measureLeg },
    (subject, [rawStart, rawElapsed]) => {
      const startedAtSeconds = Math.abs(rawStart)
      const elapsedMs = Math.abs(rawElapsed)
      const elapsed = Result.getOrThrow(
        subject(MeasureLegCommand.make({ startedAtSeconds, nowMs: startedAtSeconds * 1000 + elapsedMs })),
      )
      return S.is(LegElapsed)(elapsed) && elapsed.wallMs === elapsedMs
    },
  )

  it.prop(
    '∀sd_ClockBehindTheMark_≡NotMeasured',
    { of: [S.Int, S.Int], subject: measureLeg },
    (subject, [rawStart, rawBehind]) => {
      const startedAtSeconds = Math.abs(rawStart)
      const elapsed = Result.getOrThrow(
        subject(MeasureLegCommand.make({ startedAtSeconds, nowMs: startedAtSeconds * 1000 - Math.abs(rawBehind) - 1 })),
      )
      return S.is(LegClockBehind)(elapsed)
    },
  )
})
