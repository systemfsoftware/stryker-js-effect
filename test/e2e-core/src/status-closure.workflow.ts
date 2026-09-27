import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { JourneyAvailability, type StatusWaiver, StatusWitness, WitnessRegistry } from './closure.schema.js'

export class StatusClosureCommand extends S.TaggedClass<StatusClosureCommand>()('StatusClosureCommand', {
  statuses: S.Array(Mutant.MutantStatusSchema),
  registry: WitnessRegistry,
  journeys: S.Array(JourneyAvailability),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const StatusClosureTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/StatusClosure')
type StatusClosureTypeId = typeof StatusClosureTypeId

export class StatusClosure extends S.TaggedClass<StatusClosure>()('StatusClosure', {
  witnesses: S.Array(StatusWitness),
}) {
  readonly [StatusClosureTypeId] = StatusClosureTypeId
}

export class StatusUnwitnessed extends S.TaggedError<StatusUnwitnessed>()('StatusUnwitnessed', {
  status: S.String,
}) {
  override get message(): string {
    return `status closure: the ${this.status} status has neither a witnessing journey nor a waiver`
  }
}

export class StatusUnknown extends S.TaggedError<StatusUnknown>()('StatusUnknown', {
  status: S.String,
}) {
  override get message(): string {
    return `status closure: the witness registry names the ${this.status} status, which the status contract does not have`
  }
}

export class StatusWitnessDuplicated extends S.TaggedError<StatusWitnessDuplicated>()('StatusWitnessDuplicated', {
  status: S.String,
}) {
  override get message(): string {
    return `status closure: more than one journey witnesses the ${this.status} status`
  }
}

export class StatusWaiverStale extends S.TaggedError<StatusWaiverStale>()('StatusWaiverStale', {
  status: S.String,
}) {
  override get message(): string {
    return `status closure: the waiver for the ${this.status} status is stale, because a journey already witnesses it`
  }
}

export class StatusWaiverForProducedStatus extends S.TaggedError<StatusWaiverForProducedStatus>()(
  'StatusWaiverForProducedStatus',
  { status: S.String },
) {
  override get message(): string {
    return `status closure: the ${this.status} status is produced by this wave, so no waiver may cover it`
  }
}

export class StatusJourneyUnusable extends S.TaggedError<StatusJourneyUnusable>()('StatusJourneyUnusable', {
  status: S.String,
  journey: S.String,
}) {
  override get message(): string {
    return `status closure: the witness for the ${this.status} status names the journey ${this.journey}, which the lane does not run`
  }
}

export const StatusClosureFailure = S.Union([
  StatusUnwitnessed,
  StatusUnknown,
  StatusWitnessDuplicated,
  StatusWaiverStale,
  StatusWaiverForProducedStatus,
  StatusJourneyUnusable,
])
export type StatusClosureFailure = typeof StatusClosureFailure.Type

const PRODUCED_STATUSES: ReadonlyArray<Mutant.MutantStatus> = ['NoCoverage', 'Pending']

const witnessesFor = (registry: WitnessRegistry, status: Mutant.MutantStatus): ReadonlyArray<StatusWitness> =>
  registry.witnesses.filter((witness) => witness.status === status)

const waiversFor = (registry: WitnessRegistry, status: Mutant.MutantStatus): ReadonlyArray<StatusWaiver> =>
  registry.waivers.filter((waiver) => waiver.status === status)

const registryStatuses = (
  registry: WitnessRegistry,
): ReadonlyArray<Mutant.MutantStatus> => [
  ...registry.witnesses.map((witness) => witness.status),
  ...registry.waivers.map((waiver) => waiver.status),
]

const duplicateOf = <A>(values: ReadonlyArray<A>): Option.Option<A> =>
  Option.fromUndefinedOr(values.find((value, index) => values.indexOf(value) !== index))

const journeyUsable = (journeys: ReadonlyArray<JourneyAvailability>, path: string): boolean =>
  journeys.some((journey) => Boolean.and(journey.path === path, journey.usable))

const unknownStatusRefusal = (command: StatusClosureCommand): Result.Result<void, StatusClosureFailure> =>
  Option.match(
    Arr.findFirst(registryStatuses(command.registry), (status) => Boolean.not(command.statuses.includes(status))),
    {
      onNone: () => Result.succeed(undefined),
      onSome: (status) => Result.fail(StatusUnknown.make({ status })),
    },
  )

const duplicateWitnessRefusal = (command: StatusClosureCommand): Result.Result<void, StatusClosureFailure> =>
  Option.match(duplicateOf(command.registry.witnesses.map((witness) => witness.status)), {
    onNone: () => Result.succeed(undefined),
    onSome: (status) => Result.fail(StatusWitnessDuplicated.make({ status })),
  })

const producedWaiverRefusal = (command: StatusClosureCommand): Result.Result<void, StatusClosureFailure> =>
  Option.match(Arr.findFirst(command.registry.waivers, (waiver) => PRODUCED_STATUSES.includes(waiver.status)), {
    onNone: () => Result.succeed(undefined),
    onSome: (waiver) => Result.fail(StatusWaiverForProducedStatus.make({ status: waiver.status })),
  })

const staleWaiverRefusal = (command: StatusClosureCommand): Result.Result<void, StatusClosureFailure> =>
  Option.match(
    Arr.findFirst(command.registry.waivers, (waiver) => witnessesFor(command.registry, waiver.status).length > 0),
    {
      onNone: () => Result.succeed(undefined),
      onSome: (waiver) => Result.fail(StatusWaiverStale.make({ status: waiver.status })),
    },
  )

const witnessStep = (
  command: StatusClosureCommand,
  status: Mutant.MutantStatus,
): Result.Result<Option.Option<StatusWitness>, StatusClosureFailure> =>
  Option.match(Arr.head(witnessesFor(command.registry, status)), {
    onNone: () =>
      Option.match(Arr.head(waiversFor(command.registry, status)), {
        onNone: () => Result.fail(StatusUnwitnessed.make({ status })),
        onSome: () => Result.succeed(Option.none()),
      }),
    onSome: (witness) =>
      Boolean.match(journeyUsable(command.journeys, witness.journey), {
        onTrue: () => Result.succeed(Option.some(witness)),
        onFalse: () => Result.fail(StatusJourneyUnusable.make({ status: witness.status, journey: witness.journey })),
      }),
  })

const witnessesRefusal = (
  command: StatusClosureCommand,
): Result.Result<ReadonlyArray<StatusWitness>, StatusClosureFailure> =>
  command.statuses.reduce<Result.Result<ReadonlyArray<StatusWitness>, StatusClosureFailure>>(
    (accumulated, status) =>
      Result.flatMap(
        accumulated,
        (witnesses) =>
          Result.map(witnessStep(command, status), (witness) =>
            Option.match(witness, {
              onNone: () => witnesses,
              onSome: (value) => [...witnesses, value],
            })),
      ),
    Result.succeed([]),
  )

const decide = (command: StatusClosureCommand): Result.Result<StatusClosure, StatusClosureFailure> =>
  Result.flatMap(
    unknownStatusRefusal(command),
    () =>
      Result.flatMap(duplicateWitnessRefusal(command), () =>
        Result.flatMap(producedWaiverRefusal(command), () =>
          Result.flatMap(staleWaiverRefusal(command), () =>
            Result.map(witnessesRefusal(command), (witnesses) =>
              StatusClosure.make({ witnesses }))))),
  )

export const statusClosure = Workflow.make({
  command: StatusClosureCommand,
  decision: StatusClosure,
  error: StatusClosureFailure,
  decide,
})
