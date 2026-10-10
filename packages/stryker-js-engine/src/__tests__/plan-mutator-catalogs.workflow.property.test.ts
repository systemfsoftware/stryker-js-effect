import { StockCatalog } from '@systemfsoftware/stryker-js-cli-contract'
import { MutatorCatalog } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type MergedCatalog,
  MutatorCatalogRefused,
  MutatorCatalogsPlanned,
  planMutatorCatalogs,
  PlanMutatorCatalogsCommand,
  type ProviderCatalog,
} from '../plan-mutator-catalogs.workflow.js'

const stock: MergedCatalog = Effect.runSync(
  S.decodeEffect(MutatorCatalog.Catalog)(StockCatalog.StockCatalog),
)

const NAMESPACES = ['acme', 'beta'] as const

const namespaceArb = Arbitrary.schema(S.Literals(NAMESPACES))

const orderedNamespacesArb = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.map((reversed) => ({
    first: reversed ? 'beta' as const : 'acme' as const,
    second: reversed ? 'acme' as const : 'beta' as const,
  })),
)

const entryOf = (id: string, name: string): ProviderCatalog['entries'][number] => ({
  id: MutatorCatalog.Id.make(id),
  name: MutatorCatalog.Name.make(name),
  tier: 'default',
  definition: 'a probe definition',
  examples: [{ before: 'probe', after: ['probe'] }],
})

const catalogOf = (
  moduleName: string,
  namespace: string,
  names: readonly [string, ...string[]],
): ProviderCatalog => ({
  moduleName,
  namespace: MutatorCatalog.Provider.make(namespace),
  entries: [
    entryOf(`${namespace}-probe-0`, names[0]),
    ...names.slice(1).map((name, index) => entryOf(`${namespace}-probe-${index + 1}`, name)),
  ],
})

const namesOf = (
  catalogs: readonly { readonly entries: readonly { readonly name: string }[] }[],
): readonly string[] => catalogs.flatMap((catalog) => catalog.entries.map((entry) => entry.name))

const stockNameArb = Arbitrary.schema(StockCatalog.StockMutatorName)

describe('planMutatorCatalogs', () => {
  it.prop(
    '∀ns_DistinctNamespaces_≡UnionOfStockAndProviders',
    { of: [orderedNamespacesArb], subject: planMutatorCatalogs },
    (subject, [namespaces]) => {
      const providers = [
        catalogOf('module-0', namespaces.first, [`${namespaces.first}/Probe`]),
        catalogOf('module-1', namespaces.second, [`${namespaces.second}/Probe`]),
      ]
      const result = subject(PlanMutatorCatalogsCommand.make({ stock, providers }))
      if (!Result.isSuccess(result) || !S.is(MutatorCatalogsPlanned)(result.success)) {
        return false
      }
      return JSON.stringify(namesOf(result.success.catalogs)) ===
        JSON.stringify([...namesOf([stock]), ...namesOf(providers)])
    },
  )

  it.prop(
    '∀ns_SharedNamespace_≡RefusedNamingBothModules',
    { of: [namespaceArb], subject: planMutatorCatalogs },
    (subject, [namespace]) => {
      const first = catalogOf('module-a', namespace, [`${namespace}/Probe`])
      const second = catalogOf('module-b', namespace, [`${namespace}/Other`])
      const result = subject(PlanMutatorCatalogsCommand.make({ stock, providers: [first, second] }))
      return Result.isFailure(result) && S.is(MutatorCatalogRefused)(result.failure) &&
        result.failure.reason === 'DuplicateNamespace' &&
        JSON.stringify(result.failure.modules) === JSON.stringify(['module-a', 'module-b'])
    },
  )

  it.prop(
    '∀ns_ForeignNamespace_≡RefusedAsAnUnownedName',
    { of: [namespaceArb], subject: planMutatorCatalogs },
    (subject, [namespace]) => {
      const foreign = NAMESPACES.find((candidate) => candidate !== namespace) ?? namespace
      const provider = catalogOf('module-a', namespace, [`${foreign}/Probe`])
      const result = subject(PlanMutatorCatalogsCommand.make({ stock, providers: [provider] }))
      return Result.isFailure(result) && S.is(MutatorCatalogRefused)(result.failure) &&
        result.failure.reason === 'UnownedName' &&
        result.failure.name === `${foreign}/Probe` &&
        JSON.stringify(result.failure.modules) === JSON.stringify(['module-a'])
    },
  )

  it.prop(
    '∀name_StockName_≡RefusedAsAStockName',
    { of: [stockNameArb], subject: planMutatorCatalogs },
    (subject, [stockName]) => {
      const provider = catalogOf('module-a', 'stryker', [stockName])
      const result = subject(PlanMutatorCatalogsCommand.make({ stock, providers: [provider] }))
      return Result.isFailure(result) && S.is(MutatorCatalogRefused)(result.failure) &&
        result.failure.reason === 'StockName' &&
        result.failure.name === stockName
    },
  )
})
