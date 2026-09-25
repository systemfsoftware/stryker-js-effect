import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'

import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  type CheckerContractBroken,
  CheckerSkippedRequested,
} from '../admit-checker-answer.workflow.js'
import { type CheckerCrash, type CheckerResourceService } from './Checker.handle.js'
import {
  type CheckerRequest,
  type CheckRaw,
  compileErrorAnswersOf,
  logSkippedMutants,
  lookupOf,
  partitionedFor,
  partitionMutantsForWire,
  recordSkipped,
  singletonGroupsOf,
  undescribableIdsOf,
  writeDecidedAnswers,
  writeDecidedGroups,
} from './Checker.parts.js'

const readCheckCommand = (input: CheckerRequest) =>
  Effect.gen(function*() {
    const partitioned = partitionedFor(input)
    yield* logSkippedMutants({ checkerName: input.checkerName, undescribable: partitioned.undescribable })
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

const readGroupCommand = (input: CheckerRequest) =>
  Effect.gen(function*() {
    const partitioned = partitionedFor(input)
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
      lookup: input.lookup,
    } satisfies CheckRaw
  })

const commandFailed = (issue: string, input: CheckRaw) =>
  Checker.CheckerFailed.make({
    cause: issue,
    checkerName: input.checkerName,
    mutantIds: input.plans.map((plan) => plan.mutant.id),
  })

const checkCell = Sandwich.named('stryker.checker.check_plans')(readCheckCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckResultDecision: ({ pairs }, raw) =>
      writeDecidedAnswers({ plans: raw.plans, checkerName: raw.checkerName, answers: pairs }),
    CheckGroupDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'check', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed(issue, raw)),
  })

const groupCell = Sandwich.named('stryker.checker.group_plans')(readGroupCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckGroupDecision: ({ groups }, raw) =>
      writeDecidedGroups({ plans: raw.plans, checkerName: raw.checkerName, idGroups: groups }),
    CheckResultDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'group', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed(issue, raw)),
  })

const checkGroupedCell = groupCell.pipe(
  Cell.flatMap((groups) =>
    Cell.mapInput(
      Cell.collect(checkCell, (perGroup) => perGroup.flat()),
      (input: CheckerRequest) => groups.map((group) => ({ ...input, plans: group })),
    )
  ),
)

export const checkGroupedPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): Effect.Effect<
    readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[],
    CheckerCrash | Checker.CheckerFailed | CheckerContractBroken
  >
  (
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): (
    checker: CheckerResourceService,
  ) => Effect.Effect<
    readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[],
    CheckerCrash | Checker.CheckerFailed | CheckerContractBroken
  >
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly Mutant.RunPlan[]) =>
    checkGroupedCell.run({
      checker,
      checkerName,
      plans,
      lookup: lookupOf(partitionMutantsForWire(plans)),
    }),
)
