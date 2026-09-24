import { Workflow } from '@systemfsoftware/effect-cell-types'
import { MutantActivationSchema, MutantStatusSchema } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export { MutantStatusSchema }

export const PlannedMutantRunOptions = S.Struct({
  mutantActivation: MutantActivationSchema,
  timeout: S.Finite,
  sandboxFileName: S.String,
  disableBail: S.Boolean,
  reloadEnvironment: S.Boolean,
  testFilter: S.optional(S.Array(S.String)),
  hitLimit: S.optional(S.Finite),
})

export class PlanMutantRunCommand extends S.TaggedClass<PlanMutantRunCommand>()('PlanMutantRunCommand', {
  options: S.Struct({
    disableBail: S.Boolean,
    timeoutMS: S.Finite,
    timeoutFactor: S.Finite,
    ignoreStatic: S.Boolean,
  }),
  timeOverheadMS: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    timeOverheadMS: 'stryker.mutant_test_plan.time_overhead_ms',
  } as const
}
