import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Checker, type Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  CheckerSkippedRequested,
} from '../admit-checker-answer.workflow.js'
import {
  type CheckedPlansResult,
  type CheckerRequest,
  type CheckRaw,
  commandFailed,
  compileErrorAnswersOf,
  logSkippedMutants,
  partitionedFor,
  plansByIdOf,
  recordSkipped,
} from './Checker.protocol.js'

const attachPlansToPairs = (
  plans: readonly Mutant.RunPlan[],
  pairs: readonly { readonly id: string; readonly result: Checker.CheckResult }[],
): CheckedPlansResult => {
  const byId = plansByIdOf(plans)
  return Array.filterMap(pairs, ({ id, result }) =>
    Result.map(
      Result.fromOption(Option.fromUndefinedOr(byId.get(id)), () => id),
      (plan): readonly [Mutant.RunPlan, Checker.CheckResult] => [plan, result],
    ))
}

const readCheckCommand = Effect.fnUntraced(function*(input: CheckerRequest) {
  const partitioned = partitionedFor(input)
  yield* logSkippedMutants(input.checkerName, partitioned.undescribable)
  yield* recordSkipped(partitioned.undescribable.length)
  yield* Effect.annotateCurrentSpan({
    'stryker.checker.skipped_mutants_count': partitioned.undescribable.length,
  })
  const answers = yield* input.checker.check(input.checkerName, partitioned.wire)
  return {
    _tag: 'CheckerCommand' as const,
    checkerName: input.checkerName,
    requestedIds: input.plans.map((plan) => plan.mutant.id),
    phase: 'check' as const,
    answers: { ...compileErrorAnswersOf(partitioned.undescribable), ...answers },
    checker: input.checker,
    plans: input.plans,
    lookup: input.lookup,
  } satisfies CheckRaw
})

export const checkCell = Sandwich.named(SpanTaxonomy.Spans.checkerCheckPlans.name)(readCheckCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckResultDecision: ({ pairs }, raw) => Effect.succeed(attachPlansToPairs(raw.plans, pairs)),
    CheckGroupDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'check', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed({ issue, input: raw })),
  })
