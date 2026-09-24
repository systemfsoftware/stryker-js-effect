import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Mutant, RunPlan as MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter'
import { CheckerFailed, CheckerMutantWire, type CheckResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  CheckerCommand,
  CheckResultDecision,
  CheckerSkippedRequested,
  type CheckerContractBroken,
} from '../admit-checker-answer.workflow.js'
import { checkerMutantsSkipped } from './checker.metrics.js'
import { type CheckerCrash, type CheckerResourceService } from './Checker.handle.js'
import { CheckerMutantFromMutant, UndescribableMutant } from './Checker.schema.js'

interface GroupPartition {
  readonly groups: readonly (readonly MutantRunPlan[])[]
  readonly grouped: ReadonlySet<string>
  readonly unrequested: readonly string[]
}

const plansById = (plans: readonly MutantRunPlan[]) =>
  new Map(plans.map((plan): readonly [string, MutantRunPlan] => [plan.mutant.id, plan]))

const missingPlanIds = (plans: readonly MutantRunPlan[], present: ReadonlySet<string>) =>
  plans.map((plan) => plan.mutant.id).filter((id) => !present.has(id))

const answeredPlanIds = (paired: readonly (readonly [MutantRunPlan, CheckResult])[]) =>
  new Set(paired.map(([plan]) => plan.mutant.id))

const partitionAnswers = (byId: ReadonlyMap<string, MutantRunPlan>, answers: Readonly<Record<string, CheckResult>>) => {
  const entries = Object.entries(answers).map(([id, answer]) => ({
    id,
    answer,
    plan: Option.fromUndefinedOr(byId.get(id)),
  }))
  return {
    paired: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: () => [],
        onSome: (plan) => [[plan, entry.answer] as const],
      })
    ),
    unrequested: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: () => [entry.id],
        onSome: () => [],
      })
    ),
  }
}

const admitAnsweredPlans = (
  checkerName: string,
  plans: readonly MutantRunPlan[],
  paired: readonly (readonly [MutantRunPlan, CheckResult])[],
) =>
  Match.value(missingPlanIds(plans, answeredPlanIds(paired))).pipe(
    Match.when(
      (missing) => missing.length > 0,
      (missing) => Result.fail(CheckerSkippedRequested.make({ checkerName, phase: 'check', missingIds: [...missing] })),
    ),
    Match.orElse(() => Result.succeed(paired)),
  )

const pairCheckResults = (
  checkerName: string,
  plans: readonly MutantRunPlan[],
  answers: Readonly<Record<string, CheckResult>>,
) =>
  Match.value(partitionAnswers(plansById(plans), answers)).pipe(
    Match.when(
      (partition) => partition.unrequested.length > 0,
      (partition) =>
        Result.fail(
          CheckerAnsweredUnrequested.make({
            checkerName,
            phase: 'check',
            unrequestedIds: [...partition.unrequested],
            requestedIds: plans.map((plan) => plan.mutant.id),
          }),
        ),
    ),
    Match.orElse((partition) => admitAnsweredPlans(checkerName, plans, partition.paired)),
  )

const partitionGroupIds = (byId: ReadonlyMap<string, MutantRunPlan>, idGroup: readonly string[]) => {
  const entries = idGroup.map((id) => ({ id, plan: Option.fromUndefinedOr(byId.get(id)) }))
  return {
    plans: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: () => [],
        onSome: (plan) => [plan],
      })
    ),
    grouped: new Set(idGroup),
    unrequested: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: () => [entry.id],
        onSome: () => [],
      })
    ),
  }
}

const partitionGroups = (byId: ReadonlyMap<string, MutantRunPlan>, idGroups: readonly (readonly string[])[]) => {
  const parts = idGroups.map((idGroup) => partitionGroupIds(byId, idGroup))
  return {
    groups: parts.map((part) => part.plans),
    grouped: new Set(parts.flatMap((part) => [...part.grouped])),
    unrequested: parts.flatMap((part) => part.unrequested),
  }
}

const admitGroupedPlans = (checkerName: string, plans: readonly MutantRunPlan[], partition: GroupPartition) =>
  Match.value(missingPlanIds(plans, partition.grouped)).pipe(
    Match.when(
      (missing) => missing.length > 0,
      (missing) => Result.fail(CheckerSkippedRequested.make({ checkerName, phase: 'group', missingIds: [...missing] })),
    ),
    Match.orElse(() => Result.succeed(partition.groups)),
  )

const pairGroups = (checkerName: string, plans: readonly MutantRunPlan[], idGroups: readonly (readonly string[])[]) =>
  Match.value(partitionGroups(plansById(plans), idGroups)).pipe(
    Match.when(
      (partition) => partition.unrequested.length > 0,
      (partition) =>
        Result.fail(
          CheckerAnsweredUnrequested.make({
            checkerName,
            phase: 'group',
            unrequestedIds: [...partition.unrequested],
            requestedIds: plans.map((plan) => plan.mutant.id),
          }),
        ),
    ),
    Match.orElse((partition) => admitGroupedPlans(checkerName, plans, partition)),
  )

type DecidedAnswer = CheckResultDecision['pairs'][number]

const writeDecidedAnswers = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  answers: readonly DecidedAnswer[],
) =>
  Effect.fromResult(
    pairCheckResults(
      checkerName,
      plans,
      Object.fromEntries(answers.map((answer): readonly [string, CheckResult] => [answer.id, answer.result])),
    ),
  )

const writeDecidedGroups = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  idGroups: readonly (readonly string[])[],
) => Effect.fromResult(pairGroups(checkerName, plans, idGroups))

interface PartitionedMutants {
  readonly wire: readonly CheckerMutantWire[]
  readonly undescribable: readonly UndescribableMutant[]
}

const wireRecordOf = (mutant: Mutant) =>
  Result.mapError(
    S.decodeResult(CheckerMutantFromMutant)(mutant),
    (error) => UndescribableMutant.make({ id: mutant.id, fileName: mutant.fileName, reason: error.message }),
  )

const partitionMutantsForWire = (plans: readonly MutantRunPlan[]): PartitionedMutants => {
  const [undescribable, wire] = Array.separate(Array.map(plans, (plan) => wireRecordOf(plan.mutant)))
  return { wire, undescribable }
}

const compileErrorAnswersOf = (undescribable: readonly UndescribableMutant[]) =>
  Object.fromEntries(
    undescribable.map((mutant): readonly [string, CheckResult] => [
      mutant.id,
      { status: 'compileError', reason: mutant.reason },
    ]),
  )

const singletonGroupsOf = (undescribable: readonly UndescribableMutant[]) => undescribable.map((mutant) => [mutant.id])

const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]) =>
  new Set(undescribable.map((mutant) => mutant.id))

interface WireLookup {
  readonly wireById: ReadonlyMap<string, CheckerMutantWire>
  readonly undescribableById: ReadonlyMap<string, UndescribableMutant>
}

const lookupOf = (partitioned: PartitionedMutants): WireLookup => ({
  wireById: new Map(partitioned.wire.map((mutant) => [mutant.id, mutant])),
  undescribableById: new Map(partitioned.undescribable.map((mutant) => [mutant.id, mutant])),
})

const selectedFromLookup = (plans: readonly MutantRunPlan[], lookup: WireLookup): PartitionedMutants => {
  const [undescribable, wire] = Array.separate(
    Array.map(plans, (plan) =>
      Option.match(Option.fromUndefinedOr(lookup.wireById.get(plan.mutant.id)), {
        onSome: Result.succeed,
        onNone: () =>
          Option.match(Option.fromUndefinedOr(lookup.undescribableById.get(plan.mutant.id)), {
            onSome: Result.fail,
            onNone: () => wireRecordOf(plan.mutant),
          }),
      }),
    ),
  )
  return { wire, undescribable }
}

const SKIPPED_IDS_IN_WARNING = 5

const skippedIdsOf = (undescribable: readonly UndescribableMutant[]) =>
  `${undescribable.slice(0, SKIPPED_IDS_IN_WARNING).map((item) => item.id).join(', ')}${
    Option.match(
      Option.liftPredicate(undescribable.length, (count) => count > SKIPPED_IDS_IN_WARNING),
      {
        onNone: () => '',
        onSome: (count) => `, +${count - SKIPPED_IDS_IN_WARNING} more`,
      },
    )
  }`

const refusalReasonsOf = (undescribable: readonly UndescribableMutant[]) =>
  [...new Set(undescribable.map((mutant) => mutant.reason))].join('; ')

const logSkippedMutants = (checkerName: string, undescribable: readonly UndescribableMutant[]) =>
  Match.value(undescribable.length).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() =>
      Effect.logWarning(
        `Checker "${checkerName}" skipped ${undescribable.length} mutant(s) it cannot be told about: ${
          refusalReasonsOf(undescribable)
        } (${skippedIdsOf(undescribable)})`,
      )
    ),
  )

const recordSkipped = (skipped: number) =>
  Boolean.match(skipped > 0, {
    onTrue: () => Metric.update(checkerMutantsSkipped, skipped),
    onFalse: () => Effect.void,
  })

interface CheckerRequest {
  readonly checker: CheckerResourceService
  readonly checkerName: string
  readonly plans: readonly MutantRunPlan[]
  readonly lookup: WireLookup | undefined
}

type CheckRaw = typeof CheckerCommand.Encoded & {
  readonly checker: CheckerResourceService
  readonly plans: readonly MutantRunPlan[]
  readonly lookup: WireLookup | undefined
}

const partitionedFor = (input: CheckerRequest) =>
  Option.match(Option.fromUndefinedOr(input.lookup), {
    onSome: (known) => selectedFromLookup(input.plans, known),
    onNone: () => partitionMutantsForWire(input.plans),
  })

const readCheckCommand = (input: CheckerRequest) =>
  Effect.gen(function*() {
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
  CheckerFailed.make({
    cause: issue,
    checkerName: input.checkerName,
    mutantIds: input.plans.map((plan) => plan.mutant.id),
  })

const checkCell = Sandwich.named('stryker.checker.check_plans')(readCheckCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckResultDecision: ({ pairs }, raw) => writeDecidedAnswers(raw.plans, raw.checkerName, pairs),
    CheckGroupDecision: (_decision, raw) =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName: raw.checkerName, phase: 'check', missingIds: [] })),
    CheckerAnsweredUnrequested: (breach) => Effect.fail(CheckerAnsweredUnrequested.make(breach)),
    CheckerSkippedRequested: (breach) => Effect.fail(CheckerSkippedRequested.make(breach)),
    CommandRejected: ({ issue }, raw) => Effect.fail(commandFailed(issue, raw)),
  })

const groupCell = Sandwich.named('stryker.checker.group_plans')(readGroupCommand)
  .decide(admitCheckerAnswer)
  .write({
    CheckGroupDecision: ({ groups }, raw) => writeDecidedGroups(raw.plans, raw.checkerName, groups),
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
    ),
  ),
)

export const checkGroupedPlans: {
  (
    checker: CheckerResourceService,
    checkerName: string,
    plans: readonly MutantRunPlan[],
  ): Effect.Effect<
    readonly (readonly [MutantRunPlan, CheckResult])[],
    CheckerCrash | CheckerFailed | CheckerContractBroken
  >
  (
    checkerName: string,
    plans: readonly MutantRunPlan[],
  ): (
    checker: CheckerResourceService,
  ) => Effect.Effect<
    readonly (readonly [MutantRunPlan, CheckResult])[],
    CheckerCrash | CheckerFailed | CheckerContractBroken
  >
} = dual(
  3,
  (checker: CheckerResourceService, checkerName: string, plans: readonly MutantRunPlan[]) =>
    checkGroupedCell.run({
      checker,
      checkerName,
      plans,
      lookup: lookupOf(partitionMutantsForWire(plans)),
    }),
)
