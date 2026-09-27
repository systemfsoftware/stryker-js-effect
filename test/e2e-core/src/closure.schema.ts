import { Mutant, MutatorCatalog } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const CatalogEntryRef = S.Struct({
  id: MutatorCatalog.Id,
  name: Mutant.MutatorName,
  tier: MutatorCatalog.Tier,
})
export type CatalogEntryRef = typeof CatalogEntryRef.Type

export const WaiverReason = S.NonEmptyString
export type WaiverReason = typeof WaiverReason.Type

export const PlacementWaiver = S.Struct({ name: Mutant.MutatorName, reason: WaiverReason })
export type PlacementWaiver = typeof PlacementWaiver.Type

export const StatusWaiver = S.Struct({ status: Mutant.MutantStatusSchema, reason: WaiverReason })
export type StatusWaiver = typeof StatusWaiver.Type

export const StatusWitness = S.Struct({ status: Mutant.MutantStatusSchema, journey: S.String })
export type StatusWitness = typeof StatusWitness.Type

export const WitnessRegistry = S.Struct({
  witnesses: S.Array(StatusWitness),
  waivers: S.Array(StatusWaiver),
})
export type WitnessRegistry = typeof WitnessRegistry.Type

export const JourneyAvailability = S.Struct({ path: S.String, usable: S.Boolean })
export type JourneyAvailability = typeof JourneyAvailability.Type
