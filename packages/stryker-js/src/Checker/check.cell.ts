import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Checker, type Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  CheckerSkippedRequested,
} from '../admit-checker-answer.workflow.js'
import { checkerMutantsSkipped } from './Checker.handle.js'
import {
  type CheckedPlansResult,
  type CheckerRequest,
  type CheckRaw,
  commandFailed,
  compileErrorAnswersOf,
  describeCommandOf,
  partitionedMutantsOf,
  plansByIdOf,
} from './Checker.schema.js'
import { describeCheckerMutants } from './describe-checker-mutants.workflow.js'
import { type SkipWarning, warnSkippedMutants, WarnSkippedMutantsCommand } from './warn-skipped-mutants.workflow.js'

const attachPlansToPairs = (
  request: CheckerRequest,
  pairs: readonly { readonly id: string; readonly result: Checker.CheckResult }[],
): CheckedPlansResult => {
  const byId = plansByIdOf(request)
  return Array.filterMap(pairs, ({ id, result }) =>
    Result.map(
      Result.fromOption(Option.fromUndefinedOr(byId.get(id)), () => id),
      (plan): readonly [Mutant.RunPlan, Checker.CheckResult] => [plan, result],
    ))
}

const logSkippedMutants = Effect.fn(SpanTaxonomy.Spans.checkerLogSkipped.name)(function*(warning: SkipWarning) {
  yield* Match.valueTags(warning, {
    NoMutantSkipped: () => Effect.void,
    MutantsSkippedWarned: (warned) => Effect.logWarning(warned.warning),
  })
})

const recordSkipped = Effect.fn(SpanTaxonomy.Spans.checkerRecordSkipped.name)(function*(warning: SkipWarning) {
  yield* Match.valueTags(warning, {
    NoMutantSkipped: () => Effect.void,
    MutantsSkippedWarned: (warned) => Metric.update(checkerMutantsSkipped, warned.skipped),
  })
})

const readCheckCommand = Effect.fnUntraced(function*(input: CheckerRequest) {
  const described = yield* Effect.fromResult(describeCheckerMutants(describeCommandOf(input)))
  const partitioned = partitionedMutantsOf(described)
  const warning = yield* Effect.fromResult(warnSkippedMutants(WarnSkippedMutantsCommand.make({
    checkerName: input.checkerName,
    skipped: partitioned.undescribable,
  })))
  yield* logSkippedMutants(warning)
  yield* recordSkipped(warning)
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
  } satisfies CheckRaw
})

export const checkCell = Sandwich.named(SpanTaxonomy.Spans.checkerCheckPlans.name)(readCheckCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckResultDecision: ({ pairs }, raw) => Effect.succeed(attachPlansToPairs(raw, pairs)),
    CheckGroupDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'check', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed({ issue, input: raw })),
  })
