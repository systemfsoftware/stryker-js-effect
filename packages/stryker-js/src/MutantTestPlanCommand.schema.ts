import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export class MutantTestPlanCommand extends S.TaggedClass<MutantTestPlanCommand>()('MutantTestPlanCommand', {
  mutants: S.Array(Mutant.Mutant),
  timeOverheadMS: S.Finite,
  timeSpentAllTests: S.Finite,
  globalTestFilter: S.String.pipe(S.Array, S.optional),
  hitsByMutantId: S.Record(S.String, S.Finite),
  staticCoverage: S.optional(S.Record(S.String, S.Finite)),
  testsByMutantId: S.Record(S.String, S.Array(S.String)),
  testTimeById: S.Record(S.String, S.Finite),
  options: S.Struct({
    disableBail: S.Boolean,
    timeoutMS: S.Finite,
    timeoutFactor: S.Finite,
    ignoreStatic: S.Boolean,
  }),
  sandboxFileByName: S.Record(S.String, S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    timeOverheadMS: 'stryker.mutant_test_plan.time_overhead_ms',
    timeSpentAllTests: 'stryker.mutant_test_plan.time_spent_all_tests_ms',
  } as const
}
