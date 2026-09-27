import { StockCatalog } from '@systemfsoftware/stryker-js-cli-contract'
import { MutatorCatalog } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  decodeMutatorSelection,
  DecodeMutatorSelectionCommand,
  MutatorSelectionDecoded,
  MutatorSelectionRefused,
} from '../decode-mutator-selection.workflow.js'
import {
  type MergedCatalog,
  MutatorCatalogsPlanned,
  planMutatorCatalogs,
  PlanMutatorCatalogsCommand,
  type ProviderCatalog,
} from '../plan-mutator-catalogs.workflow.js'

const stock: MergedCatalog = Effect.runSync(S.decodeEffect(MutatorCatalog.Catalog)(StockCatalog.StockCatalog))

const pluginEntryArb = Arbitrary.schema(
  S.Struct({ provider: MutatorCatalog.Provider, bareName: StockCatalog.StockMutatorName }),
).pipe(
  Arbitrary.map(({ provider, bareName }) => {
    const namespace = Boolean.match(provider === 'stryker', {
      onTrue: () => 'stryker-plugin',
      onFalse: () => provider,
    })
    return { namespace, name: `${namespace}/${bareName}` }
  }),
)
const undeclaredNameArb = Arbitrary.schema(StockCatalog.StockMutatorName).pipe(
  Arbitrary.map((name) => `probe/${name}`),
)
const stockNameArb = Arbitrary.schema(StockCatalog.StockMutatorName)
const stockDefaultNameArb = Arbitrary.schema(StockCatalog.StockDefaultName)
const acceptedSelectionArb = Arbitrary.schema(
  S.Struct({
    excludedMutations: S.Array(StockCatalog.StockMutatorName),
    optInMutations: S.Array(StockCatalog.StockOptInName),
  }),
)

const emptyCatalog: MergedCatalog = { provider: MutatorCatalog.Provider.make('stryker'), entries: [] }

const commandOf = (input: {
  readonly catalogs?: readonly MergedCatalog[]
  readonly excludedMutations?: readonly string[]
  readonly optInMutations?: readonly string[]
}): DecodeMutatorSelectionCommand =>
  DecodeMutatorSelectionCommand.make({
    catalogs: [...(input.catalogs ?? [stock])],
    excludedMutations: [...(input.excludedMutations ?? [])],
    optInMutations: [...(input.optInMutations ?? [])],
  })

const providerOf = (entry: { readonly namespace: string; readonly name: string }): ProviderCatalog => ({
  moduleName: `${entry.namespace}-provider.mjs`,
  namespace: MutatorCatalog.Provider.make(entry.namespace),
  entries: [{
    id: MutatorCatalog.Id.make(`${entry.namespace}-probe`),
    name: MutatorCatalog.Name.make(entry.name),
    tier: 'default',
    definition: 'a probe definition',
    examples: [{ before: 'probe', after: ['probe'] }],
  }],
})

const catalogsWith = (providers: readonly ProviderCatalog[]): readonly MergedCatalog[] | undefined =>
  Result.match(
    planMutatorCatalogs(PlanMutatorCatalogsCommand.make({ stock, providers: [...providers] })),
    {
      onFailure: () => undefined,
      onSuccess: (planned) => (S.is(MutatorCatalogsPlanned)(planned) ? [...planned.catalogs] : undefined),
    },
  )

const refusalNaming = (
  outcome: Result.Result<MutatorSelectionDecoded, MutatorSelectionRefused>,
  name: string,
  reason: MutatorSelectionRefused['reason'],
): boolean =>
  Result.match(outcome, {
    onFailure: (failure) =>
      S.is(MutatorSelectionRefused)(failure) && failure.reason === reason && failure.message.includes(name),
    onSuccess: () => false,
  })

const namesOf = (
  pick: (decision: MutatorSelectionDecoded) => readonly string[],
): (outcome: Result.Result<MutatorSelectionDecoded, MutatorSelectionRefused>) => readonly string[] | undefined =>
(outcome) =>
  Result.match(outcome, {
    onFailure: () => undefined,
    onSuccess: (decision) => [...pick(decision)],
  })

const excludedNamesOf = namesOf((decision) => decision.excludedMutations)
const optInNamesOf = namesOf((decision) => decision.optInMutations)

const sameNames = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
  left !== undefined && JSON.stringify(left) === JSON.stringify(right)

describe('decodeMutatorSelection', () => {
  it.prop(
    '∀n_NameNoCatalogDeclares_≡RefusedNamingTheEntry',
    { of: [undeclaredNameArb], subject: decodeMutatorSelection },
    (subject, [name]) =>
      refusalNaming(subject(commandOf({ optInMutations: [name] })), name, 'UnknownName') &&
      refusalNaming(subject(commandOf({ excludedMutations: [name] })), name, 'UnknownName'),
  )

  it.prop(
    '∀n_StockDefaultName_≡RefusedAsANonOptInNamingTheEntry',
    { of: [stockDefaultNameArb], subject: decodeMutatorSelection },
    (subject, [name]) => refusalNaming(subject(commandOf({ optInMutations: [name] })), name, 'NotOptInTier'),
  )

  it.prop(
    '∀e_ProviderEntry_≡ExcludedDecodesOnlyWhileTheProviderIsMerged',
    { of: [pluginEntryArb], subject: decodeMutatorSelection },
    (subject, [entry]) => {
      const catalogs = catalogsWith([providerOf(entry)])
      return catalogs !== undefined &&
        sameNames(excludedNamesOf(subject(commandOf({ catalogs, excludedMutations: [entry.name] }))), [entry.name]) &&
        refusalNaming(subject(commandOf({ excludedMutations: [entry.name] })), entry.name, 'UnknownName')
    },
  )

  it.prop(
    '∀s_DeclaredSelection_≡DecodedUnchanged',
    { of: [acceptedSelectionArb], subject: decodeMutatorSelection },
    (subject, [selection]) => {
      const outcome = subject(
        commandOf({
          excludedMutations: selection.excludedMutations,
          optInMutations: selection.optInMutations,
        }),
      )
      return sameNames(excludedNamesOf(outcome), selection.excludedMutations) &&
        sameNames(optInNamesOf(outcome), selection.optInMutations)
    },
  )

  it.prop(
    '∀n_DeclaredNameUnderAnEmptyCatalog_≡RefusedNamingTheEntry',
    { of: [stockNameArb], subject: decodeMutatorSelection },
    (subject, [name]) =>
      refusalNaming(subject(commandOf({ catalogs: [emptyCatalog], excludedMutations: [name] })), name, 'UnknownName'),
  )
})
