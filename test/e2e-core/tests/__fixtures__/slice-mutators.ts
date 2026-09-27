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
  readonly selection: Mutator.MutatorSelection
  readonly entries: ReadonlyArray<CatalogEntryRef>
}

const contributionOf = (input: {
  readonly moduleName: string
  readonly fixtureDirectory: URL
}): Effect.Effect<MutatorProvider.ContributionValue, PlacementFixtureUnreadable> =>
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

const sliceMutatorsOf = (
  contributions: readonly MutatorProvider.ContributionValue[],
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
    return {
      selection: Mutator.selectMutators(Mutator.registryOf(catalogs, contributions), optInMutations),
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
