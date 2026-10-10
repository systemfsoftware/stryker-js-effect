import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  CheckerIgnoredWithoutRule,
  CheckerSkippedRequested,
} from '../admit-checker-answer.workflow.js'
import type { CheckerCellError, CheckerRequest, CheckRaw } from './Checker.handle.js'
import {
  commandFailed,
  describeCommandOf,
  type GroupedPlansResult,
  partitionedMutantsOf,
  plansByIdOf,
  singletonGroupsOf,
  undescribableIdsOf,
} from './Checker.schema.js'
import { describeCheckerMutants } from './describe-checker-mutants.workflow.js'

const attachPlansToGroups = (
  request: CheckerRequest,
  groups: readonly (readonly string[])[],
): GroupedPlansResult => {
  const byId = plansByIdOf(request)
  return groups.map((group) =>
    Array.filterMap(
      group,
      (id) => Result.fromOption(Option.fromUndefinedOr(byId.get(id)), () => id),
    )
  )
}

const readGroupCommand = Effect.fnUntraced(function*(input: CheckerRequest) {
  const described = yield* Effect.fromResult(describeCheckerMutants(describeCommandOf(input)))
  const partitioned = partitionedMutantsOf(described)
  yield* Effect.annotateCurrentSpan({
    'stryker.checker.skipped_mutants_count': partitioned.undescribable.length,
  })
  const undescribableIds = undescribableIdsOf(partitioned.undescribable)
  const checkerGroups = yield* input.checker.group(input.checkerName, partitioned.wire)
  const withoutSkipped = checkerGroups
    .map((group) => group.filter((id) => !undescribableIds.has(id)))
    .filter((group) => group.length > 0)
  return {
    _tag: 'CheckerCommand' as const,
    checkerName: input.checkerName,
    requestedIds: input.plans.map((plan) => plan.mutant.id),
    phase: 'group' as const,
    idGroups: [...singletonGroupsOf(partitioned.undescribable), ...withoutSkipped],
    checker: input.checker,
    plans: input.plans,
  } satisfies CheckRaw
})

export const groupCell: Cell.Cell<CheckerRequest, GroupedPlansResult, CheckerCellError, never> = Sandwich.named(
  SpanTaxonomy.Spans.checkerGroupPlans.name,
)(readGroupCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckGroupDecision: ({ groups }, raw) => Effect.succeed(attachPlansToGroups(raw, groups)),
    CheckResultDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'group', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CheckerIgnoredWithoutRule: (breach) => Effect.fail(CheckerIgnoredWithoutRule.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed({ issue, input: raw })),
  })
