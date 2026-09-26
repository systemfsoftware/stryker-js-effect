import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  CheckerCommand,
  type CheckerContractBroken,
  CheckerSkippedRequested,
} from '../admit-checker-answer.workflow.js'
import { type CheckerCrash, type CheckerResourceService } from './Checker.handle.js'
import { CheckerMutantFromMutant, UndescribableMutant } from './Checker.schema.js'

const wireRecordOf = (mutant: Mutant.Mutant) =>
  Result.mapError(
    S.decodeResult(CheckerMutantFromMutant)(mutant),
    (error) => UndescribableMutant.make({ id: mutant.id, fileName: mutant.fileName, reason: error.message }),
  )

interface PartitionedMutants {
  readonly wire: readonly Checker.CheckerMutantWire[]
  readonly undescribable: readonly UndescribableMutant[]
}

const partitionMutantsForWire = (plans: readonly Mutant.RunPlan[]): PartitionedMutants => {
  const [undescribable, wire] = Array.separate(Array.map(plans, (plan) => wireRecordOf(plan.mutant)))
  return { wire, undescribable }
}

const compileErrorAnswersOf = (undescribable: readonly UndescribableMutant[]) =>
  Object.fromEntries(
    undescribable.map((mutant): readonly [string, Checker.CheckResult] => [
      mutant.id,
      { status: 'compileError', reason: mutant.reason },
    ]),
  )

const singletonGroupsOf = (undescribable: readonly UndescribableMutant[]) => undescribable.map((mutant) => [mutant.id])

const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]): ReadonlySet<string> =>
  new Set(undescribable.map((mutant) => mutant.id))

interface WireLookup {
  readonly wireById: ReadonlyMap<string, Checker.CheckerMutantWire>
  readonly undescribableById: ReadonlyMap<string, UndescribableMutant>
}

const lookupOf = (partitioned: PartitionedMutants): WireLookup => ({
  wireById: new Map(partitioned.wire.map((mutant) => [mutant.id, mutant])),
  undescribableById: new Map(partitioned.undescribable.map((mutant) => [mutant.id, mutant])),
})

const wireOrFallbackOf = (mutant: Mutant.Mutant, lookup: WireLookup) =>
  Option.getOrElse(
    Option.map(Option.fromUndefinedOr(lookup.wireById.get(mutant.id)), Result.succeed),
    () =>
      Option.getOrElse(
        Option.map(Option.fromUndefinedOr(lookup.undescribableById.get(mutant.id)), Result.fail),
        () => wireRecordOf(mutant),
      ),
  )

const selectedFromLookup = (plans: readonly Mutant.RunPlan[], lookup: WireLookup): PartitionedMutants => {
  const [undescribable, wire] = Array.separate(Array.map(plans, (plan) => wireOrFallbackOf(plan.mutant, lookup)))
  return { wire, undescribable }
}

const SKIPPED_IDS_IN_WARNING = 5

const skippedIdsOf = (undescribable: readonly UndescribableMutant[]) =>
  `${undescribable.slice(0, SKIPPED_IDS_IN_WARNING).map((item) => item.id).join(', ')}${
    Option.getOrElse(
      Option.map(
        Option.liftPredicate(undescribable.length, (count) => count > SKIPPED_IDS_IN_WARNING),
        (count) => `, +${count - SKIPPED_IDS_IN_WARNING} more`,
      ),
      () => '',
    )
  }`

const refusalReasonsOf = (undescribable: readonly UndescribableMutant[]) =>
  [...new Set(undescribable.map((mutant) => mutant.reason))].join('; ')

const runWhen = <A, E, R>(condition: boolean, effect: Effect.Effect<A, E, R>): Effect.Effect<void, E, R> =>
  Effect.forEach(
    Option.toArray(Option.liftPredicate(effect, () => condition)),
    (run) => run,
    { discard: true },
  )

const logSkippedMutants = Effect.fn('stryker.checker.log_skipped')(function*(
  checkerName: string,
  undescribable: readonly UndescribableMutant[],
) {
  yield* runWhen(
    undescribable.length > 0,
    Effect.logWarning(
      `Checker "${checkerName}" skipped ${undescribable.length} mutant(s) it cannot be told about: ${
        refusalReasonsOf(undescribable)
      } (${skippedIdsOf(undescribable)})`,
    ),
  )
})

const recordSkipped = Effect.fn('stryker.checker.record_skipped')(function*(skipped: number) {
  yield* runWhen(skipped > 0, Metric.update(UndescribableMutant.skipped, skipped))
})

interface CheckerRequest {
  readonly checker: CheckerResourceService
  readonly checkerName: string
  readonly plans: readonly Mutant.RunPlan[]
  readonly lookup: WireLookup
}

type CheckRaw = typeof CheckerCommand.Encoded & {
  readonly checker: CheckerResourceService
  readonly plans: readonly Mutant.RunPlan[]
  readonly lookup: WireLookup
}

const partitionedFor = (input: CheckerRequest) => selectedFromLookup(input.plans, input.lookup)

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

const readGroupCommand = Effect.fnUntraced(function*(input: CheckerRequest) {
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

const plansByIdOf = (plans: readonly Mutant.RunPlan[]) =>
  new Map<string, Mutant.RunPlan>(plans.map((plan) => [plan.mutant.id, plan]))

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

const attachPlansToGroups = (
  plans: readonly Mutant.RunPlan[],
  groups: readonly (readonly string[])[],
): GroupedPlansResult => {
  const byId = plansByIdOf(plans)
  return groups.map((group) =>
    Array.filterMap(
      group,
      (id) => Result.fromOption(Option.fromUndefinedOr(byId.get(id)), () => id),
    )
  )
}

const commandFailed = (issue: string, input: CheckRaw) =>
  Checker.CheckerFailed.make({
    cause: issue,
    checkerName: input.checkerName,
    mutantIds: input.plans.map((plan) => plan.mutant.id),
  })

const checkCell = Sandwich.named('stryker.checker.check_plans')(readCheckCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckResultDecision: ({ pairs }, raw) => Effect.succeed(attachPlansToPairs(raw.plans, pairs)),
    CheckGroupDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'check', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed(issue, raw)),
  })

const groupCell = Sandwich.named('stryker.checker.group_plans')(readGroupCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckGroupDecision: ({ groups }, raw) => Effect.succeed(attachPlansToGroups(raw.plans, groups)),
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

type CheckerCellError = CheckerCrash | Checker.CheckerFailed | CheckerContractBroken

type GroupedPlansResult = readonly (readonly Mutant.RunPlan[])[]

type CheckedPlansResult = readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[]

const checkRequestOf = (
  checker: CheckerResourceService,
  checkerName: string,
  plans: readonly Mutant.RunPlan[],
): CheckerRequest => ({
  checker,
  checkerName,
  plans,
  lookup: lookupOf(partitionMutantsForWire(plans)),
})

export const groupPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): Effect.Effect<GroupedPlansResult, CheckerCellError>
  (
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): (checker: CheckerResourceService) => Effect.Effect<GroupedPlansResult, CheckerCellError>
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly Mutant.RunPlan[]) =>
    groupCell.run(checkRequestOf(checker, checkerName, plans)),
)

export const checkPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): Effect.Effect<CheckedPlansResult, CheckerCellError>
  (
    checkerName: string,
    plans: readonly Mutant.RunPlan[],
  ): (checker: CheckerResourceService) => Effect.Effect<CheckedPlansResult, CheckerCellError>
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly Mutant.RunPlan[]) =>
    checkCell.run(checkRequestOf(checker, checkerName, plans)),
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
    checkGroupedCell.run(checkRequestOf(checker, checkerName, plans)),
)
