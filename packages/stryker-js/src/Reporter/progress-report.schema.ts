import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

const ProgressCapabilitiesSchema = S.Struct({ reloadEnvironment: S.Boolean })

const PlannedTicksMs = S.Finite.pipe(
  S.check(S.isGreaterThanOrEqualTo(0), S.isLessThanOrEqualTo(2 * Number.MAX_SAFE_INTEGER)),
)

export const ProgressTallySchema = S.Struct({
  survived: Report.NonNegativeInt,
  timedOut: Report.NonNegativeInt,
  tested: Report.NonNegativeInt,
  mutants: Report.NonNegativeInt,
  total: Report.NonNegativeFinite,
  ticks: Report.NonNegativeFinite,
  ticksByMutantId: S.Record(Mutant.MutantId, PlannedTicksMs),
  timing: Reporter.RunTimingSchema,
  capabilities: ProgressCapabilitiesSchema,
  startedAt: S.Finite,
})
export type ProgressTally = typeof ProgressTallySchema.Type

export const ProgressBarStateSchema = S.Struct({
  total: Report.NonNegativeFinite,
  curr: Report.NonNegativeFinite,
})
export type ProgressBarState = typeof ProgressBarStateSchema.Type

export const isBarComplete = (bar: ProgressBarState): boolean => bar.curr >= bar.total

export const ProgressStateSchema = S.Struct({
  tally: ProgressTallySchema,
  bar: S.NullOr(ProgressBarStateSchema),
})
export type ProgressState = typeof ProgressStateSchema.Type

export class ProgressReportCommand
  extends S.TaggedClass<ProgressReportCommand, { readonly brand: unique symbol }>()('ProgressReportCommand', {
    state: ProgressStateSchema,
    event: S.UndefinedOr(Reporter.ReporterEventUnion),
    now: S.Finite,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
