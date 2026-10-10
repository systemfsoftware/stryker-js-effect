import { Workflow } from '@systemfsoftware/effect-cell-types'
import { MutatorCatalog } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean } from 'effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const STOCK_NAMESPACE = 'stryker'

const CatalogEntrySchema = S.Struct({
  id: MutatorCatalog.Id,
  name: MutatorCatalog.Name,
  tier: MutatorCatalog.Tier,
  definition: MutatorCatalog.Definition,
  examples: S.Array(MutatorCatalog.Example),
})

export const MergedCatalogSchema = S.Struct({
  provider: MutatorCatalog.Provider,
  entries: S.Array(CatalogEntrySchema),
})
export type MergedCatalog = typeof MergedCatalogSchema.Type

export const ProviderCatalogSchema = S.Struct({
  moduleName: S.String,
  namespace: MutatorCatalog.Provider,
  entries: S.Array(CatalogEntrySchema),
})
export type ProviderCatalog = typeof ProviderCatalogSchema.Type

export class PlanMutatorCatalogsCommand extends S.TaggedClass<PlanMutatorCatalogsCommand>()(
  'PlanMutatorCatalogsCommand',
  {
    stock: MergedCatalogSchema,
    providers: S.Array(ProviderCatalogSchema),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MutatorCatalogsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutatorCatalogs')
type MutatorCatalogsTypeId = typeof MutatorCatalogsTypeId

export class MutatorCatalogsPlanned extends S.TaggedClass<MutatorCatalogsPlanned>()('MutatorCatalogsPlanned', {
  catalogs: S.Array(MergedCatalogSchema),
}) {
  readonly [MutatorCatalogsTypeId] = MutatorCatalogsTypeId
}

export class MutatorCatalogRefused extends S.TaggedError<MutatorCatalogRefused>()('MutatorCatalogRefused', {
  reason: S.Literals(['DuplicateNamespace', 'StockName', 'UnownedName']),
  name: S.String,
  modules: S.Array(S.String),
}) {
  override get message(): string {
    return `Refused the mutator catalog of ${this.modules.join(', ')}: ${this.reason} "${this.name}".`
  }
}

const ownsName = (namespace: string, name: string): boolean =>
  Boolean.match(namespace === STOCK_NAMESPACE, {
    onTrue: () => !name.includes('/'),
    onFalse: () => name.startsWith(`${namespace}/`),
  })

const stockNamesOf = (stock: MergedCatalog): readonly string[] => stock.entries.map((entry) => entry.name)

interface NamespaceClash {
  readonly namespace: string
  readonly modules: readonly [string, string]
}

const clashOf = (
  providers: readonly ProviderCatalog[],
  provider: ProviderCatalog,
  index: number,
): readonly NamespaceClash[] =>
  Option.match(
    Option.fromNullishOr(
      providers.slice(0, index).find((candidate) => candidate.namespace === provider.namespace),
    ),
    {
      onNone: (): readonly NamespaceClash[] => [],
      onSome: (earlier): readonly NamespaceClash[] => [
        { namespace: provider.namespace, modules: [earlier.moduleName, provider.moduleName] },
      ],
    },
  )

const namespaceClashOf = (providers: readonly ProviderCatalog[]): Option.Option<NamespaceClash> =>
  Option.fromNullishOr(
    providers.flatMap((provider, index) => clashOf(providers, provider, index)).at(0),
  )

const duplicateNamespaceOf = (providers: readonly ProviderCatalog[]): Option.Option<MutatorCatalogRefused> =>
  Option.map(
    namespaceClashOf(providers),
    (clash) =>
      MutatorCatalogRefused.make({
        reason: 'DuplicateNamespace',
        name: clash.namespace,
        modules: [...clash.modules],
      }),
  )

interface OffendingEntry {
  readonly moduleName: string
  readonly name: string
  readonly reason: 'StockName' | 'UnownedName'
}

const reasonOf = (stockName: boolean): 'StockName' | 'UnownedName' =>
  Boolean.match(stockName, {
    onTrue: (): 'StockName' => 'StockName',
    onFalse: (): 'UnownedName' => 'UnownedName',
  })

const offends = (stockName: boolean, owned: boolean): boolean =>
  Boolean.match(stockName, { onTrue: () => true, onFalse: () => !owned })

interface OffendingCandidate {
  readonly entry: OffendingEntry
  readonly offending: boolean
}

const offendingCandidatesOf = (
  stock: MergedCatalog,
  providers: readonly ProviderCatalog[],
): readonly OffendingCandidate[] => {
  const stockNames = stockNamesOf(stock)
  return providers.flatMap((provider) =>
    provider.entries.map((entry) => {
      const stockName = stockNames.includes(entry.name)
      return {
        entry: { moduleName: provider.moduleName, name: entry.name, reason: reasonOf(stockName) },
        offending: offends(stockName, ownsName(provider.namespace, entry.name)),
      }
    })
  )
}

const offendingEntryOf = (
  stock: MergedCatalog,
  providers: readonly ProviderCatalog[],
): Option.Option<OffendingEntry> =>
  Option.map(
    Option.fromNullishOr(offendingCandidatesOf(stock, providers).find((candidate) => candidate.offending)),
    (candidate): OffendingEntry => candidate.entry,
  )

const offendingEntryRefusalOf = (
  stock: MergedCatalog,
  providers: readonly ProviderCatalog[],
): Option.Option<MutatorCatalogRefused> =>
  Option.map(
    offendingEntryOf(stock, providers),
    (offending) =>
      MutatorCatalogRefused.make({
        reason: offending.reason,
        name: offending.name,
        modules: [offending.moduleName],
      }),
  )

const refusalOf = (command: PlanMutatorCatalogsCommand): Option.Option<MutatorCatalogRefused> =>
  Option.orElse(
    duplicateNamespaceOf(command.providers),
    () => offendingEntryRefusalOf(command.stock, command.providers),
  )

const catalogsOf = (command: PlanMutatorCatalogsCommand): readonly MergedCatalog[] => [
  command.stock,
  ...command.providers.map((provider) => ({ provider: provider.namespace, entries: provider.entries })),
]

const planCatalogs = (
  command: PlanMutatorCatalogsCommand,
): Result.Result<MutatorCatalogsPlanned, MutatorCatalogRefused> =>
  Option.match(refusalOf(command), {
    onNone: () => Result.succeed(MutatorCatalogsPlanned.make({ catalogs: [...catalogsOf(command)] })),
    onSome: (refused) => Result.fail(refused),
  })

export const planMutatorCatalogs = Workflow.make({
  command: PlanMutatorCatalogsCommand,
  decision: MutatorCatalogsPlanned,
  error: MutatorCatalogRefused,
  decide: planCatalogs,
})
