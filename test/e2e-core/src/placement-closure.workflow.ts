import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CatalogEntryRef, PlacementWaiver } from './closure.schema.js'

export class PlacementClosureCommand extends S.TaggedClass<PlacementClosureCommand>()('PlacementClosureCommand', {
  entries: S.Array(CatalogEntryRef),
  witnessed: S.Array(Mutant.MutatorName),
  waivers: S.Array(PlacementWaiver),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const PlacementClosureTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/PlacementClosure')
type PlacementClosureTypeId = typeof PlacementClosureTypeId

export class PlacementClosure extends S.TaggedClass<PlacementClosure>()('PlacementClosure', {
  entries: S.Array(CatalogEntryRef),
}) {
  readonly [PlacementClosureTypeId] = PlacementClosureTypeId
}

export class PlacementUnwitnessed extends S.TaggedError<PlacementUnwitnessed>()('PlacementUnwitnessed', {
  name: S.String,
  tier: S.String,
}) {
  override get message(): string {
    return `the ${this.tier} catalog entry "${this.name}" has neither an annotated witness nor a named waiver`
  }
}

export class PlacementWaiverStale extends S.TaggedError<PlacementWaiverStale>()('PlacementWaiverStale', {
  name: S.String,
}) {
  override get message(): string {
    return `the placement waiver for "${this.name}" names an entry that is witnessed or is not in the catalog`
  }
}

export const PlacementClosureFailure = S.Union([PlacementUnwitnessed, PlacementWaiverStale])
export type PlacementClosureFailure = typeof PlacementClosureFailure.Type

const waivedNames = (waivers: ReadonlyArray<PlacementWaiver>): ReadonlyArray<Mutant.MutatorName> =>
  waivers.map((waiver) => waiver.name)

const coveredBy = (command: PlacementClosureCommand, name: Mutant.MutatorName): boolean =>
  Boolean.or(command.witnessed.includes(name), waivedNames(command.waivers).includes(name))

const unwitnessedOf = (command: PlacementClosureCommand): ReadonlyArray<CatalogEntryRef> =>
  command.entries.filter((entry) => Boolean.not(coveredBy(command, entry.name)))

const entryNamesOf = (command: PlacementClosureCommand): ReadonlyArray<Mutant.MutatorName> =>
  command.entries.map((entry) => entry.name)

const waiverIsStale = (command: PlacementClosureCommand, waiver: PlacementWaiver): boolean =>
  Boolean.or(command.witnessed.includes(waiver.name), Boolean.not(entryNamesOf(command).includes(waiver.name)))

const unwitnessedRefusal = (
  command: PlacementClosureCommand,
): Result.Result<void, PlacementClosureFailure> =>
  Option.match(Arr.head(unwitnessedOf(command)), {
    onNone: () => Result.succeed(undefined),
    onSome: (entry) => Result.fail(PlacementUnwitnessed.make({ name: entry.name, tier: entry.tier })),
  })

const staleWaiverRefusal = (
  command: PlacementClosureCommand,
): Result.Result<PlacementClosure, PlacementClosureFailure> =>
  Option.match(Arr.findFirst(command.waivers, (waiver) => waiverIsStale(command, waiver)), {
    onNone: () => Result.succeed(PlacementClosure.make({ entries: [...command.entries] })),
    onSome: (waiver) => Result.fail(PlacementWaiverStale.make({ name: waiver.name })),
  })

const decide = (command: PlacementClosureCommand): Result.Result<PlacementClosure, PlacementClosureFailure> =>
  Result.flatMap(unwitnessedRefusal(command), () => staleWaiverRefusal(command))

export const placementClosure = Workflow.make({
  command: PlacementClosureCommand,
  decision: PlacementClosure,
  error: PlacementClosureFailure,
  decide,
})
