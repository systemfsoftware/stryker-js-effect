import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const CheckerBusyIntervalSchema = S.Struct({
  startMs: Report.NonNegativeFinite,
  endMs: Report.NonNegativeFinite,
})
