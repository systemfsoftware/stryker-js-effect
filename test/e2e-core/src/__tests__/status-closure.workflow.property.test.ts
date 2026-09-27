import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type JourneyAvailability, type StatusWaiver, type StatusWitness } from '../closure.schema.js'
import {
  statusClosure,
  StatusClosureCommand,
  StatusJourneyUnusable,
  StatusUnknown,
  StatusUnwitnessed,
  StatusWaiverForProducedStatus,
  StatusWaiverStale,
  StatusWitnessDuplicated,
} from '../status-closure.workflow.js'

const STATUSES: ReadonlyArray<Mutant.MutantStatus> = [...Mutant.MutantStatusSchema.literals]

const PRODUCED_STATUSES = ['NoCoverage', 'Pending'] as const

const WITNESS_JOURNEY = 'tests/mutation-run.e2e.test.ts'

const witnessOf = (status: Mutant.MutantStatus, journey: string): StatusWitness => ({ status, journey })

const waiverOf = (status: Mutant.MutantStatus, reason: string): StatusWaiver => ({ status, reason })

const witnessesFor = (statuses: ReadonlyArray<Mutant.MutantStatus>): ReadonlyArray<StatusWitness> =>
  statuses.map((status) => witnessOf(status, WITNESS_JOURNEY))

const journeysFor = (paths: ReadonlyArray<string>): ReadonlyArray<JourneyAvailability> =>
  paths.map((path) => ({ path, usable: true }))

const commandOf = (
  statuses: ReadonlyArray<Mutant.MutantStatus>,
  witnesses: ReadonlyArray<StatusWitness>,
  waivers: ReadonlyArray<StatusWaiver>,
  journeys: ReadonlyArray<JourneyAvailability>,
) =>
  StatusClosureCommand.make({
    statuses: [...statuses],
    registry: { witnesses: [...witnesses], waivers: [...waivers] },
    journeys: [...journeys],
  })

const without = (statuses: ReadonlyArray<Mutant.MutantStatus>, omitted: Mutant.MutantStatus) =>
  statuses.filter((status) => status !== omitted)

describe('statusClosure', () => {
  it.prop(
    '∀s_EveryStatusWitnessed_≡ClosurePassesOnAUsableJourney',
    { of: [S.NonEmptyString], subject: statusClosure },
    (subject, [journey]) => {
      const witnesses = STATUSES.map((status) => witnessOf(status, journey))
      return Result.match(subject(commandOf(STATUSES, witnesses, [], journeysFor([journey]))), {
        onFailure: () => false,
        onSuccess: (closure) =>
          closure.witnesses.length === STATUSES.length &&
          closure.witnesses.every((witness) => witness.journey === journey),
      })
    },
  )

  it.prop(
    '∀s_StatusAssignedToNoJourney_≡RefusedNamingIt',
    { of: [Mutant.MutantStatusSchema], subject: statusClosure },
    (subject, [omitted]) =>
      Result.match(
        subject(commandOf(STATUSES, witnessesFor(without(STATUSES, omitted)), [], journeysFor([WITNESS_JOURNEY]))),
        {
          onFailure: (failure) => S.is(StatusUnwitnessed)(failure) && failure.status === omitted,
          onSuccess: () => false,
        },
      ),
  )

  it.prop(
    '∀s_WaivedStatus_≡ClosurePasses',
    { of: [Mutant.MutantStatusSchema, S.NonEmptyString], subject: statusClosure },
    (subject, [omitted, reason]) => {
      if (PRODUCED_STATUSES.some((produced) => produced === omitted)) {
        return true
      }
      return Result.match(
        subject(
          commandOf(
            STATUSES,
            witnessesFor(without(STATUSES, omitted)),
            [waiverOf(omitted, reason)],
            journeysFor([WITNESS_JOURNEY]),
          ),
        ),
        {
          onFailure: () => false,
          onSuccess: (closure) => closure.witnesses.length === STATUSES.length - 1,
        },
      )
    },
  )

  it.prop(
    '∀s_WaiverOverAProducedStatus_≡Refused',
    { of: [S.Literals(PRODUCED_STATUSES), S.NonEmptyString], subject: statusClosure },
    (subject, [produced, reason]) =>
      Result.match(
        subject(
          commandOf(
            STATUSES,
            witnessesFor(without(STATUSES, produced)),
            [waiverOf(produced, reason)],
            journeysFor([WITNESS_JOURNEY]),
          ),
        ),
        {
          onFailure: (failure) => S.is(StatusWaiverForProducedStatus)(failure) && failure.status === produced,
          onSuccess: () => false,
        },
      ),
  )

  it.prop(
    '∀s_WaiverOverAWitnessedStatus_≡RefusedAsStale',
    { of: [Mutant.MutantStatusSchema, S.NonEmptyString], subject: statusClosure },
    (subject, [witnessed, reason]) => {
      if (PRODUCED_STATUSES.some((produced) => produced === witnessed)) {
        return true
      }
      return Result.match(
        subject(
          commandOf(STATUSES, witnessesFor(STATUSES), [waiverOf(witnessed, reason)], journeysFor([WITNESS_JOURNEY])),
        ),
        {
          onFailure: (failure) => S.is(StatusWaiverStale)(failure) && failure.status === witnessed,
          onSuccess: () => false,
        },
      )
    },
  )

  it.prop(
    '∀s_WitnessOnAJourneyTheLaneDoesNotRun_≡RefusedNamingTheJourney',
    { of: [Mutant.MutantStatusSchema, S.NonEmptyString], subject: statusClosure },
    (subject, [status, journey]) => {
      if (journey === WITNESS_JOURNEY) {
        return true
      }
      const witnesses = [
        witnessOf(status, journey),
        ...witnessesFor(without(STATUSES, status)),
      ]
      const journeys = [...journeysFor([WITNESS_JOURNEY]), { path: journey, usable: false }]
      return Result.match(subject(commandOf(STATUSES, witnesses, [], journeys)), {
        onFailure: (failure) =>
          S.is(StatusJourneyUnusable)(failure) && failure.status === status && failure.journey === journey,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀s_StatusTheContractLacks_≡Refused',
    { of: [Mutant.MutantStatusSchema], subject: statusClosure },
    (subject, [outside]) => {
      const contract = without(STATUSES, outside)
      return Result.match(subject(commandOf(contract, witnessesFor(STATUSES), [], journeysFor([WITNESS_JOURNEY]))), {
        onFailure: (failure) => S.is(StatusUnknown)(failure) && failure.status === outside,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀s_TwoJourneysWitnessingOneStatus_≡Refused',
    { of: [Mutant.MutantStatusSchema, S.NonEmptyString], subject: statusClosure },
    (subject, [status, otherJourney]) => {
      if (otherJourney === WITNESS_JOURNEY || PRODUCED_STATUSES.some((produced) => produced === status)) {
        return true
      }
      const witnesses = [
        witnessOf(status, WITNESS_JOURNEY),
        witnessOf(status, otherJourney),
        ...witnessesFor(without(STATUSES, status)),
      ]
      return Result.match(
        subject(commandOf(STATUSES, witnesses, [], journeysFor([WITNESS_JOURNEY, otherJourney]))),
        {
          onFailure: (failure) => S.is(StatusWitnessDuplicated)(failure) && failure.status === status,
          onSuccess: () => false,
        },
      )
    },
  )

  it.prop(
    '∀s_WitnessRegistryOrder_≡WitnessesFollowTheContractOrder',
    { of: [Mutant.MutantStatusSchema], subject: statusClosure },
    (subject, [status]) => {
      const witnesses = [witnessOf(status, WITNESS_JOURNEY), ...witnessesFor(without(STATUSES, status))]
      return Result.match(subject(commandOf(STATUSES, witnesses, [], journeysFor([WITNESS_JOURNEY]))), {
        onFailure: () => false,
        onSuccess: (closure) => Equal.equals(closure.witnesses.map((witness) => witness.status), STATUSES),
      })
    },
  )
})
