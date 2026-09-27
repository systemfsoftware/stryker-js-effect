import { StockCatalog } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { MutatorCatalog, MutatorProvider } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'

import { type CatalogEntryRef } from '@systemfsoftware/stryker-e2e-core'
import { PlacementFixtureUnreadable, PlacementSliceUndecodable } from './placement-failure.schema.js'
import type { PlacementSlice } from './placement-slice.schema.js'
import { renderedFailureOf } from './rendered-failure.js'

export interface SliceMutators {
  readonly registry: Mutator.MutatorRegistry
  readonly selection: Mutator.MutatorSelection
  readonly entries: ReadonlyArray<CatalogEntryRef>
}

type Contribution = MutatorProvider.ContributionValue
type ProviderMutator = MutatorProvider.Mutator

const contributionOf = (input: {
  readonly moduleName: string
  readonly fixtureDirectory: URL
}): Effect.Effect<Contribution, PlacementFixtureUnreadable> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => import(new URL(input.moduleName, input.fixtureDirectory).href),
      catch: (cause) =>
        PlacementFixtureUnreadable.make({
          reason: `the provider module "${input.moduleName}" could not be loaded: ${renderedFailureOf(cause)}`,
        }),
    }),
    (loaded) =>
      Effect.mapError(
        S.decodeUnknownEffect(MutatorProvider.Contribution)(loaded.strykerMutators),
        (issue): PlacementFixtureUnreadable =>
          PlacementFixtureUnreadable.make({
            reason: `the provider module "${input.moduleName}" did not export a contribution: ${issue.message}`,
          }),
      ),
  )

const implementationsOf = (contributions: readonly Contribution[]): ReadonlyMap<string, ProviderMutator> =>
  new Map<string, ProviderMutator>([
    ...Object.entries(Mutator.defaultMutators),
    ...Object.entries(Mutator.optInMutators),
    ...contributions.flatMap(({ entries }) => entries.map((entry) => [entry.name, entry.implementation] as const)),
  ])

const registryOf = (
  catalogs: ReadonlyArray<MutatorCatalog.Catalog>,
  implementations: ReadonlyMap<string, ProviderMutator>,
): Mutator.MutatorRegistry => {
  const entriesOfTier = (tier: MutatorCatalog.Tier): ReadonlyArray<Mutator.MutatorEntry> =>
    catalogs
      .flatMap((catalog) => catalog.entries)
      .filter((entry) => entry.tier === tier)
      .flatMap((entry) => {
        const implementation = implementations.get(entry.name)
        return implementation === undefined ? [] : [[entry.name, implementation] as const]
      })
  return {
    defaults: Object.fromEntries(entriesOfTier('default')),
    optIn: Object.fromEntries(entriesOfTier('optIn')),
  }
}

const sliceMutatorsOf = (
  contributions: readonly Contribution[],
  optInMutations: readonly string[],
): Effect.Effect<SliceMutators, S.SchemaError> =>
  Effect.map(S.decodeEffect(MutatorCatalog.Catalog)(StockCatalog.StockCatalog), (stock) => {
    const catalogs: ReadonlyArray<MutatorCatalog.Catalog> = [
      stock,
      ...contributions.map((contribution) => ({
        provider: contribution.namespace,
        entries: contribution.entries,
      })),
    ]
    const registry = registryOf(catalogs, implementationsOf(contributions))
    return {
      registry,
      selection: Mutator.selectMutators(registry, optInMutations),
      entries: catalogs.flatMap((catalog) =>
        catalog.entries.map((entry): CatalogEntryRef => ({
          id: entry.id,
          name: entry.name,
          tier: entry.tier,
        }))
      ),
    }
  })

export const loadedSliceMutatorsOf = (input: {
  readonly slice: PlacementSlice
  readonly fixtureDirectory: URL
}): Effect.Effect<SliceMutators, PlacementFixtureUnreadable | PlacementSliceUndecodable> =>
  Effect.flatMap(
    Effect.forEach(input.slice.providerModules, (moduleName) =>
      contributionOf({ moduleName, fixtureDirectory: input.fixtureDirectory })),
    (contributions) =>
      Effect.mapError(
        sliceMutatorsOf(contributions, input.slice.optInMutations),
        (issue): PlacementSliceUndecodable =>
          PlacementSliceUndecodable.make({
            reason: `the slice "${input.slice.id}" named a mutator the catalogs do not declare: ${issue.message}`,
          }),
      ),
  )
