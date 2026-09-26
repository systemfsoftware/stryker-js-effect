import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CheckedPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CheckedPlan')
type CheckedPlanTypeId = typeof CheckedPlanTypeId

export class CheckedPlanPassed extends S.TaggedClass<CheckedPlanPassed>()('CheckedPlanPassed', {
  mutantId: Mutant.MutantId,
}) {
  readonly [CheckedPlanTypeId] = CheckedPlanTypeId
}

export class CheckedPlanFailed extends S.TaggedClass<CheckedPlanFailed>()('CheckedPlanFailed', {
  mutantId: Mutant.MutantId,
  reason: S.String,
}) {
  readonly [CheckedPlanTypeId] = CheckedPlanTypeId
}

export type CheckedPlanDecision = CheckedPlanPassed | CheckedPlanFailed

export class PartitionCheckedPlansCommand extends S.TaggedClass<PartitionCheckedPlansCommand>()(
  'PartitionCheckedPlansCommand',
  {
    checked: S.Array(S.Tuple([Mutant.MutantId, Checker.CheckResultSchema])),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const isFailed = (result: Checker.CheckResult): result is Checker.FailedCheckResult => result.status !== 'passed'

const failedReasonOf = (failed: Checker.FailedCheckResult): string => failed.reason

const decideCheckedPlan = (mutantId: Mutant.MutantId, result: Checker.CheckResult): CheckedPlanDecision =>
  Option.match(Option.liftPredicate(result, isFailed), {
    onNone: () => CheckedPlanPassed.make({ mutantId }),
    onSome: (failed) => CheckedPlanFailed.make({ mutantId, reason: failedReasonOf(failed) }),
  })

const decide = (
  command: PartitionCheckedPlansCommand,
): Result.Result<readonly CheckedPlanDecision[], never> =>
  Result.succeed(command.checked.map(([mutantId, result]) => decideCheckedPlan(mutantId, result)))

export const partitionCheckedPlans = Workflow.make({
  command: PartitionCheckedPlansCommand,
  decision: S.Array(S.Union([CheckedPlanPassed, CheckedPlanFailed])),
  error: S.Never,
  decide,
})
