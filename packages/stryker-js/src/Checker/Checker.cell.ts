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
  type CheckResultDecision,
} from '../admit-checker-answer.workflow.js'
import { type CheckerCrash, type CheckerResourceService } from './Checker.handle.js'
import { CheckerMutantFromMutant, UndescribableMutant } from './Checker.schema.js'

const plansById = (plans: readonly Mutant.RunPlan[]): ReadonlyMap<string, Mutant.RunPlan> =>
  new Map<string, Mutant.RunPlan>(plans.map((plan) => [plan.mutant.id, plan] as const))

const requestedIdsOf = (plans: readonly Mutant.RunPlan[]): readonly string[] => plans.map((plan) => plan.mutant.id)

const pairedAnswers = (
  byId: ReadonlyMap<string, Mutant.RunPlan>,
  answers: Readonly<Record<string, Checker.CheckResult>>,
) =>
  Array.filterMap(
    Object.entries(answers),
    ([id, result]) =>
      Result.map(
        Result.fromOption(Option.fromUndefinedOr(byId.get(id)), () => undefined),
        (plan): readonly [Mutant.RunPlan, Checker.CheckResult] => [plan, result],
      ),
  )

const missingPlanIds = (plans: readonly Mutant.RunPlan[], present: ReadonlySet<string>) =>
  requestedIdsOf(plans).filter((id) => !present.has(id))

const pairCheckResults = (
  checkerName: string,
  plans: readonly Mutant.RunPlan[],
  answers: Readonly<Record<string, Checker.CheckResult>>,
) => {
  const byId = plansById(plans)
  const requested = new Set(requestedIdsOf(plans))
  const breach = Option.firstSomeOf([
    Option.map(
      Option.liftPredicate(Object.keys(answers).filter((id) => !requested.has(id)), Array.isReadonlyArrayNonEmpty),
      (unrequestedIds): CheckerAnsweredUnrequested =>
        CheckerAnsweredUnrequested.make({
          checkerName,
          phase: 'check',
          unrequestedIds: [...unrequestedIds],
          requestedIds: requestedIdsOf(plans),
        }),
    ),
    Option.map(
      Option.liftPredicate(missingPlanIds(plans, new Set(Object.keys(answers))), Array.isReadonlyArrayNonEmpty),
      (missingIds): CheckerSkippedRequested =>
        CheckerSkippedRequested.make({ checkerName, phase: 'check', missingIds: [...missingIds] }),
    ),
  ])
  return Result.flip(Result.fromOption(breach, () => pairedAnswers(byId, answers)))
}

const groupedPlansOf = (byId: ReadonlyMap<string, Mutant.RunPlan>, idGroups: readonly (readonly string[])[]) =>
  idGroups.map((idGroup) =>
    Array.filterMap(
      idGroup,
      (id) => Result.fromOption(Option.fromUndefinedOr(byId.get(id)), () => undefined),
    )
  )

const pairGroups = (
  checkerName: string,
  plans: readonly Mutant.RunPlan[],
  idGroups: readonly (readonly string[])[],
) => {
  const byId = plansById(plans)
  const requested = new Set(requestedIdsOf(plans))
  const grouped = new Set(idGroups.flat())
  const breach = Option.firstSomeOf([
    Option.map(
      Option.liftPredicate(idGroups.flat().filter((id) => !requested.has(id)), Array.isReadonlyArrayNonEmpty),
      (unrequestedIds): CheckerAnsweredUnrequested =>
        CheckerAnsweredUnrequested.make({
          checkerName,
          phase: 'group',
          unrequestedIds: [...unrequestedIds],
          requestedIds: requestedIdsOf(plans),
        }),
    ),
    Option.map(
      Option.liftPredicate(missingPlanIds(plans, grouped), Array.isReadonlyArrayNonEmpty),
      (missingIds): CheckerSkippedRequested =>
        CheckerSkippedRequested.make({ checkerName, phase: 'group', missingIds: [...missingIds] }),
    ),
  ])
  return Result.flip(Result.fromOption(breach, () => groupedPlansOf(byId, idGroups)))
}

type DecidedAnswer = CheckResultDecision['pairs'][number]

const writeDecidedAnswers = (input: {
  readonly plans: readonly Mutant.RunPlan[]
  readonly checkerName: string
  readonly answers: readonly DecidedAnswer[]
}) =>
  Effect.fromResult(
    pairCheckResults(
      input.checkerName,
      input.plans,
      Object.fromEntries(
        input.answers.map((answer): readonly [string, Checker.CheckResult] => [answer.id, answer.result]),
      ),
    ),
  )

const writeDecidedGroups = (input: {
  readonly plans: readonly Mutant.RunPlan[]
  readonly checkerName: string
  readonly idGroups: readonly (readonly string[])[]
}) => Effect.fromResult(pairGroups(input.checkerName, input.plans, input.idGroups))

interface PartitionedMutants {
  readonly wire: readonly Checker.CheckerMutantWire[]
  readonly undescribable: readonly UndescribableMutant[]
}

const wireRecordOf = (mutant: Mutant.Mutant) =>
  Result.mapError(
    S.decodeResult(CheckerMutantFromMutant)(mutant),
    (error) => UndescribableMutant.make({ id: mutant.id, fileName: mutant.fileName, reason: error.message }),
  )

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

const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]) =>
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

const logSkippedMutants = (input: {
  readonly checkerName: string
  readonly undescribable: readonly UndescribableMutant[]
}) =>
  runWhen(
    input.undescribable.length > 0,
    Effect.logWarning(
      `Checker "${input.checkerName}" skipped ${input.undescribable.length} mutant(s) it cannot be told about: ${
        refusalReasonsOf(input.undescribable)
      } (${skippedIdsOf(input.undescribable)})`,
    ),
  )

const recordSkipped = (skipped: number) => runWhen(skipped > 0, Metric.update(UndescribableMutant.skipped, skipped))

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
      requestedIds: requestedIdsOf(input.plans),
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
      requestedIds: requestedIdsOf(input.plans),
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
    mutantIds: requestedIdsOf(input.plans),
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
