import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CheckerAnsweredUnrequested,
  CheckerCommand,
  CheckerSkippedRequested,
  type CheckResultDecision,
} from '../admit-checker-answer.workflow.js'
import type { CheckerResourceService } from './Checker.handle.js'
import { CheckerMutantFromMutant, UndescribableMutant } from './Checker.schema.js'

interface GroupPartition {
  readonly groups: readonly (readonly Mutant.RunPlan[])[]
  readonly grouped: ReadonlySet<string>
  readonly unrequested: readonly string[]
}

const plansById = (plans: readonly Mutant.RunPlan[]) =>
  new Map(plans.map((plan): readonly [string, Mutant.RunPlan] => [plan.mutant.id, plan]))

const missingPlanIds = (plans: readonly Mutant.RunPlan[], present: ReadonlySet<string>) =>
  plans.map((plan) => plan.mutant.id).filter((id) => !present.has(id))

const answeredPlanIds = (paired: readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[]) =>
  new Set(paired.map(([plan]) => plan.mutant.id))

const partitionAnswers = (
  byId: ReadonlyMap<string, Mutant.RunPlan>,
  answers: Readonly<Record<string, Checker.CheckResult>>,
) => {
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
  plans: readonly Mutant.RunPlan[],
  paired: readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[],
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
  plans: readonly Mutant.RunPlan[],
  answers: Readonly<Record<string, Checker.CheckResult>>,
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

const partitionGroupIds = (byId: ReadonlyMap<string, Mutant.RunPlan>, idGroup: readonly string[]) => {
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

const partitionGroups = (byId: ReadonlyMap<string, Mutant.RunPlan>, idGroups: readonly (readonly string[])[]) => {
  const parts = idGroups.map((idGroup) => partitionGroupIds(byId, idGroup))
  return {
    groups: parts.map((part) => part.plans),
    grouped: new Set(parts.flatMap((part) => [...part.grouped])),
    unrequested: parts.flatMap((part) => part.unrequested),
  }
}

const admitGroupedPlans = (checkerName: string, plans: readonly Mutant.RunPlan[], partition: GroupPartition) =>
  Match.value(missingPlanIds(plans, partition.grouped)).pipe(
    Match.when(
      (missing) => missing.length > 0,
      (missing) => Result.fail(CheckerSkippedRequested.make({ checkerName, phase: 'group', missingIds: [...missing] })),
    ),
    Match.orElse(() => Result.succeed(partition.groups)),
  )

const pairGroups = (checkerName: string, plans: readonly Mutant.RunPlan[], idGroups: readonly (readonly string[])[]) =>
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

export const writeDecidedAnswers = (input: {
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

export const writeDecidedGroups = (input: {
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

export const partitionMutantsForWire = (plans: readonly Mutant.RunPlan[]): PartitionedMutants => {
  const [undescribable, wire] = Array.separate(Array.map(plans, (plan) => wireRecordOf(plan.mutant)))
  return { wire, undescribable }
}

export const compileErrorAnswersOf = (undescribable: readonly UndescribableMutant[]) =>
  Object.fromEntries(
    undescribable.map((mutant): readonly [string, Checker.CheckResult] => [
      mutant.id,
      { status: 'compileError', reason: mutant.reason },
    ]),
  )

export const singletonGroupsOf = (undescribable: readonly UndescribableMutant[]) =>
  undescribable.map((mutant) => [mutant.id])

export const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]) =>
  new Set(undescribable.map((mutant) => mutant.id))

interface WireLookup {
  readonly wireById: ReadonlyMap<string, Checker.CheckerMutantWire>
  readonly undescribableById: ReadonlyMap<string, UndescribableMutant>
}

export const lookupOf = (partitioned: PartitionedMutants): WireLookup => ({
  wireById: new Map(partitioned.wire.map((mutant) => [mutant.id, mutant])),
  undescribableById: new Map(partitioned.undescribable.map((mutant) => [mutant.id, mutant])),
})

const selectedFromLookup = (plans: readonly Mutant.RunPlan[], lookup: WireLookup): PartitionedMutants => {
  const [undescribable, wire] = Array.separate(
    Array.map(plans, (plan) =>
      Option.match(Option.fromUndefinedOr(lookup.wireById.get(plan.mutant.id)), {
        onSome: Result.succeed,
        onNone: () =>
          Option.match(Option.fromUndefinedOr(lookup.undescribableById.get(plan.mutant.id)), {
            onSome: Result.fail,
            onNone: () => wireRecordOf(plan.mutant),
          }),
      })),
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

export const logSkippedMutants = (input: {
  readonly checkerName: string
  readonly undescribable: readonly UndescribableMutant[]
}) =>
  Match.value(input.undescribable.length).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() =>
      Effect.logWarning(
        `Checker "${input.checkerName}" skipped ${input.undescribable.length} mutant(s) it cannot be told about: ${
          refusalReasonsOf(input.undescribable)
        } (${skippedIdsOf(input.undescribable)})`,
      )
    ),
  )

export const recordSkipped = (skipped: number) =>
  Boolean.match(skipped > 0, {
    onTrue: () => Metric.update(UndescribableMutant.skipped, skipped),
    onFalse: () => Effect.void,
  })

export interface CheckerRequest {
  readonly checker: CheckerResourceService
  readonly checkerName: string
  readonly plans: readonly Mutant.RunPlan[]
  readonly lookup: WireLookup | undefined
}

export type CheckRaw = typeof CheckerCommand.Encoded & {
  readonly checker: CheckerResourceService
  readonly plans: readonly Mutant.RunPlan[]
  readonly lookup: WireLookup | undefined
}

export const partitionedFor = (input: CheckerRequest) =>
  Option.match(Option.fromUndefinedOr(input.lookup), {
    onSome: (known) => selectedFromLookup(input.plans, known),
    onNone: () => partitionMutantsForWire(input.plans),
  })
