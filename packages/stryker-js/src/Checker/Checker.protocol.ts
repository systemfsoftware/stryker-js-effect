import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckerCommand, type CheckerContractBroken } from '../admit-checker-answer.workflow.js'
import { type CheckerCrash, checkerMutantsSkipped, type CheckerResourceService } from './Checker.handle.js'
import { CheckerMutantFromMutant, UndescribableMutant } from './Checker.schema.js'

const wireRecordOf = (mutant: Mutant.Mutant) =>
  Result.mapError(
    S.decodeResult(CheckerMutantFromMutant)(mutant),
    (error) => UndescribableMutant.make({ id: mutant.id, fileName: mutant.fileName, reason: error.message }),
  )

export interface PartitionedMutants {
  readonly wire: readonly Checker.CheckerMutantWire[]
  readonly undescribable: readonly UndescribableMutant[]
}

const partitionMutantsForWire = (plans: readonly Mutant.RunPlan[]): PartitionedMutants => {
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

export const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]): ReadonlySet<string> =>
  new Set(undescribable.map((mutant) => mutant.id))

export interface WireLookup {
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

export const logSkippedMutants = Effect.fn(SpanTaxonomy.Spans.checkerLogSkipped.name)(function*(
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

export const recordSkipped = Effect.fn(SpanTaxonomy.Spans.checkerRecordSkipped.name)(function*(skipped: number) {
  yield* runWhen(skipped > 0, Metric.update(checkerMutantsSkipped, skipped))
})

export interface CheckerRequest {
  readonly checker: CheckerResourceService
  readonly checkerName: string
  readonly plans: readonly Mutant.RunPlan[]
  readonly lookup: WireLookup
}

export type CheckRaw = typeof CheckerCommand.Encoded & {
  readonly checker: CheckerResourceService
  readonly plans: readonly Mutant.RunPlan[]
  readonly lookup: WireLookup
}

export const partitionedFor = (input: CheckerRequest) => selectedFromLookup(input.plans, input.lookup)

export const plansByIdOf = (plans: readonly Mutant.RunPlan[]) =>
  new Map<string, Mutant.RunPlan>(plans.map((plan) => [plan.mutant.id, plan]))

export const commandFailed = (failed: { readonly issue: string; readonly input: CheckRaw }): Checker.CheckerFailed =>
  Checker.CheckerFailed.make({
    cause: failed.issue,
    checkerName: failed.input.checkerName,
    mutantIds: failed.input.plans.map((plan) => plan.mutant.id),
  })

export type CheckerCellError = CheckerCrash | Checker.CheckerFailed | CheckerContractBroken

export type GroupedPlansResult = readonly (readonly Mutant.RunPlan[])[]

export type CheckedPlansResult = readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[]

export const checkRequestOf = (
  request: {
    readonly checker: CheckerResourceService
    readonly checkerName: string
    readonly plans: readonly Mutant.RunPlan[]
  },
): CheckerRequest => ({
  checker: request.checker,
  checkerName: request.checkerName,
  plans: request.plans,
  lookup: lookupOf(partitionMutantsForWire(request.plans)),
})
