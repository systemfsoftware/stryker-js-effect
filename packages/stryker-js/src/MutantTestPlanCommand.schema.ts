import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Report, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class MutantTestPlanCommand extends S.TaggedClass<MutantTestPlanCommand>()('MutantTestPlanCommand', {
  mutants: S.Array(Mutant.Mutant),
  timeOverheadMS: Report.NonNegativeFinite,
  timeSpentAllTests: Report.NonNegativeFinite,
  globalTestFilter: S.String.pipe(S.Array, S.optional),
  hitsByMutantId: S.Record(Mutant.MutantId, Report.NonNegativeInt),
  staticCoverage: S.optional(S.Record(Mutant.MutantId, Report.NonNegativeInt)),
  testsByMutantId: S.Record(Mutant.MutantId, S.Array(TestRunner.TestId)),
  testTimeById: S.Record(TestRunner.TestId, Report.NonNegativeFinite),
  options: S.Struct({
    disableBail: S.Boolean,
    timeoutMS: Report.NonNegativeFinite,
    timeoutFactor: Report.NonNegativeFinite,
    ignoreStatic: S.Boolean,
  }),
  sandboxFileByName: S.Record(S.String, S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    timeOverheadMS: 'stryker.mutant_test_plan.time_overhead_ms',
    timeSpentAllTests: 'stryker.mutant_test_plan.time_spent_all_tests_ms',
  } as const
}
