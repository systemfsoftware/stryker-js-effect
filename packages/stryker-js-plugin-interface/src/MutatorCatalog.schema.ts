/// <reference types="vitest/importMeta" />
import * as S from 'effect/Schema'

import { MutatorName } from './Mutant.schema.js'

export const Id = S.String.check(
  S.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, { expected: 'a lowercase kebab-case catalog entry id' }),
).pipe(S.brand('MutatorCatalogId'))
export type Id = typeof Id.Type

export const Tier = S.Literals(['default', 'optIn'])
export type Tier = typeof Tier.Type

export const Definition = S.NonEmptyString
export type Definition = typeof Definition.Type

/**
 * `after` lists the replacement texts in the order the mutator emits them, and
 * is empty when the entry must not fire on `before`.
 */
export const Example = S.Struct({
  before: S.String,
  after: S.Array(S.String),
})
export type Example = typeof Example.Type

const EntryShape = S.Struct({
  id: Id,
  name: MutatorName,
  tier: Tier,
  definition: Definition,
  examples: S.Array(Example),
})

const carriesExamples = S.makeFilter((entry: typeof EntryShape.Type): string | undefined =>
  entry.examples.length === 0 ? `mutator catalog entry "${entry.id}" carries no examples` : undefined
)

const carriesASnippet = S.makeFilter((entry: typeof EntryShape.Type): string | undefined => {
  const withoutSnippet = entry.examples.find((example) => example.before.length === 0)
  return withoutSnippet === undefined
    ? undefined
    : `mutator catalog entry "${entry.id}" carries an example with an empty before`
})

export const Entry = EntryShape.check(carriesExamples, carriesASnippet)
export type Entry = typeof Entry.Type

export const Provider = S.String.check(
  S.isPattern(/^(?:stryker|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/, {
    expected: 'the stock provider "stryker" or a lowercase kebab-case plugin namespace',
  }),
).pipe(S.brand('MutatorProvider'))
export type Provider = typeof Provider.Type

const CatalogShape = S.Struct({ provider: Provider, entries: S.NonEmptyArray(Entry) })

export type CatalogText = string

export const duplicatedValue = (values: readonly CatalogText[]): string | undefined =>
  values.find((value, index) => values.indexOf(value) !== index)

const namespaceOf = (name: string): string | undefined => {
  const slash = name.indexOf('/')
  return slash === -1 ? undefined : name.slice(0, slash)
}

const entryIdsAreUnique = S.makeFilter((catalog: typeof CatalogShape.Type): string | undefined => {
  const duplicated = duplicatedValue(catalog.entries.map((entry) => entry.id))
  return duplicated === undefined ? undefined : `mutator catalog entries share the id "${duplicated}"`
})

const entryNamesAreUnique = S.makeFilter((catalog: typeof CatalogShape.Type): string | undefined => {
  const duplicated = duplicatedValue(catalog.entries.map((entry) => entry.name))
  return duplicated === undefined
    ? undefined
    : `mutator catalog entries share the mutator name "${duplicated}"`
})

const ownedByProvider = (provider: string, name: string): boolean => {
  const namespace = namespaceOf(name)
  return provider === 'stryker' ? namespace === undefined : namespace === provider
}

const providerOwnsEveryName = S.makeFilter((catalog: typeof CatalogShape.Type): string | undefined => {
  const unowned = catalog.entries.find((entry) => !ownedByProvider(catalog.provider, entry.name))
  return unowned === undefined
    ? undefined
    : `provider "${catalog.provider}" does not own the mutator name "${unowned.name}"`
})

export const Catalog = CatalogShape.check(entryIdsAreUnique, entryNamesAreUnique, providerOwnsEveryName)
export type Catalog = typeof Catalog.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Result = await import('effect/Result')

  const Namespace = S.String.check(S.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))

  const refusalOf = (value: typeof Catalog.Encoded): string | undefined =>
    Result.match(S.decodeResult(Catalog)(value), {
      onFailure: (error) => error.message,
      onSuccess: () => undefined,
    })

  const entryOf = (id: string, name: string): typeof Entry.Encoded => ({
    id,
    name,
    tier: 'default',
    definition: 'a probe definition',
    examples: [{ before: 'probe', after: ['probe'] }],
  })

  const catalogOf = (
    provider: string,
    entries: readonly [typeof Entry.Encoded, ...Array<typeof Entry.Encoded>],
  ): typeof Catalog.Encoded => ({ provider, entries })

  const completeEntry = (candidate: typeof EntryShape.Type): typeof Entry.Encoded => ({
    ...candidate,
    examples: [{ before: candidate.id, after: [candidate.name] }],
  })

  const refusedNaming = (message: string | undefined, offender: string): boolean =>
    message !== undefined && message.includes(offender)

  const accepted = (message: string | undefined): boolean => message === undefined

  const ownedNamespacedName = (namespace: string, message: string | undefined): boolean =>
    namespace === 'stryker' ? refusedNaming(message, `${namespace}/SwapArguments`) : accepted(message)

  const mismatchesRefused = (subject: (value: typeof Catalog.Encoded) => string | undefined): boolean =>
    Arr.every(
      [
        ['stryker', 'acme/SwapArguments'],
        ['acme', 'other/SwapArguments'],
      ] as const,
      ([provider, name]) => refusedNaming(subject(catalogOf(provider, [entryOf('probe-mismatch', name)])), name),
    )

  it.prop(
    '∀e_EntryWithoutExamples_≡RefusedNamingTheEntry',
    { of: [EntryShape], subject: refusalOf },
    (subject, [candidate]) => {
      const message = subject(catalogOf('stryker', [{ ...candidate, examples: [] }]))
      return refusedNaming(message, candidate.id)
    },
  )

  it.prop(
    '∀e_EntryEmptySnippet_≡RefusedNamingTheEntry',
    { of: [EntryShape], subject: refusalOf },
    (subject, [candidate]) => {
      const message = subject(
        catalogOf('stryker', [{ ...candidate, examples: [{ before: '', after: [candidate.name] }] }]),
      )
      return refusedNaming(message, candidate.id)
    },
  )

  it.prop(
    '∀e_EntryIdDuplication_≡RefusedNamingTheId',
    { of: [EntryShape], subject: refusalOf },
    (subject, [candidate]) => {
      const message = subject(catalogOf('stryker', [completeEntry(candidate), completeEntry(candidate)]))
      return refusedNaming(message, candidate.id)
    },
  )

  it.prop(
    '∀e_EntryNameDuplication_≡RefusedNamingTheName',
    { of: [EntryShape], subject: refusalOf },
    (subject, [candidate]) => {
      const twin = { ...completeEntry(candidate), id: `${candidate.id}-twin` }
      const message = subject(catalogOf('stryker', [completeEntry(candidate), twin]))
      return refusedNaming(message, candidate.name)
    },
  )

  it.prop(
    '∀e_EntryAcceptance_≡EmptySnippetOrAWorldWithoutExamples',
    { of: [EntryShape], subject: S.is(Entry) },
    (subject, [candidate]) =>
      subject(candidate) ===
        (candidate.examples.length > 0 && Arr.every(candidate.examples, (example) => example.before.length > 0)),
  )

  it.prop(
    '∀p_ProviderUnprefixedName_≡OnlyStrykerOwnsIt',
    { of: [Provider], subject: refusalOf },
    (subject, [provider]) => {
      const message = subject(catalogOf(provider, [entryOf('probe-unprefixed', 'SwapArguments')]))
      return provider === 'stryker' ? accepted(message) : refusedNaming(message, 'SwapArguments')
    },
  )

  it.prop(
    '∀ns_ProviderNamespacedName_≡OwnedOrRefusedNamingTheName',
    { of: [Namespace], subject: refusalOf },
    (subject, [namespace]) => {
      const message = subject(catalogOf(namespace, [entryOf('probe-namespaced', `${namespace}/SwapArguments`)]))
      return mismatchesRefused(subject) && ownedNamespacedName(namespace, message)
    },
  )
}
