import { Mutant, MutatorCatalog } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type CatalogEntryRef, type PlacementWaiver } from '../closure.schema.js'
import {
  placementClosure,
  PlacementClosureCommand,
  PlacementUnwitnessed,
  PlacementWaiverStale,
} from '../placement-closure.workflow.js'

const entryOf = (
  id: MutatorCatalog.Id,
  name: Mutant.MutatorName,
  tier: MutatorCatalog.Tier,
): CatalogEntryRef => ({ id, name, tier })

const commandOf = (
  entries: ReadonlyArray<CatalogEntryRef>,
  witnessed: ReadonlyArray<Mutant.MutatorName>,
  waivers: ReadonlyArray<PlacementWaiver>,
) => PlacementClosureCommand.make({ entries: [...entries], witnessed: [...witnessed], waivers: [...waivers] })

const entryInputArb = Arbitrary.schema(
  S.Struct({ id: MutatorCatalog.Id, name: Mutant.MutatorName, tier: MutatorCatalog.Tier }),
)

describe('placementClosure', () => {
  it.prop(
    '∀e_WitnessedCatalogEntry_≡ClosurePassesOverItsTier',
    { of: [entryInputArb], subject: placementClosure },
    (subject, [drawn]) => {
      const entry = entryOf(drawn.id, drawn.name, drawn.tier)
      return Result.match(subject(commandOf([entry], [drawn.name], [])), {
        onFailure: () => false,
        onSuccess: (closure) => Equal.equals(closure.entries, [entry]),
      })
    },
  )

  it.prop(
    '∀e_UnwitnessedCatalogEntry_≡RefusedNamingTheEntry',
    { of: [entryInputArb], subject: placementClosure },
    (subject, [drawn]) => {
      const entry = entryOf(drawn.id, drawn.name, drawn.tier)
      return Result.match(subject(commandOf([entry], [], [])), {
        onFailure: (failure) =>
          S.is(PlacementUnwitnessed)(failure) &&
          failure.name === drawn.name &&
          failure.tier === drawn.tier,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀e_WaivedCatalogEntry_≡ClosurePasses',
    { of: [entryInputArb, S.NonEmptyString], subject: placementClosure },
    (subject, [drawn, reason]) => {
      const entry = entryOf(drawn.id, drawn.name, drawn.tier)
      return Result.match(subject(commandOf([entry], [], [{ name: drawn.name, reason }])), {
        onFailure: () => false,
        onSuccess: (closure) => Equal.equals(closure.entries, [entry]),
      })
    },
  )

  it.prop(
    '∀e_WitnessedAndWaivedEntry_≡RefusedAsStale',
    { of: [entryInputArb, S.NonEmptyString], subject: placementClosure },
    (subject, [drawn, reason]) => {
      const entry = entryOf(drawn.id, drawn.name, drawn.tier)
      return Result.match(subject(commandOf([entry], [drawn.name], [{ name: drawn.name, reason }])), {
        onFailure: (failure) => S.is(PlacementWaiverStale)(failure) && failure.name === drawn.name,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀e_WaiverOutsideTheCatalog_≡RefusedAsStale',
    {
      of: [entryInputArb, Mutant.MutatorName, S.NonEmptyString],
      subject: placementClosure,
    },
    (subject, [drawn, otherName, reason]) => {
      if (drawn.name === otherName) {
        return true
      }
      const entry = entryOf(drawn.id, drawn.name, drawn.tier)
      return Result.match(subject(commandOf([entry], [drawn.name], [{ name: otherName, reason }])), {
        onFailure: (failure) => S.is(PlacementWaiverStale)(failure) && failure.name === otherName,
        onSuccess: () => false,
      })
    },
  )
})
