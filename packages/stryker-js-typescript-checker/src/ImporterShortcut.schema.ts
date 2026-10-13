import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { ImporterCheck, readsEditSites } from './Checker.schema.js'

export const ShortcutClause = S.Literals([
  'outside-function-body',
  'body-dependent-signature',
  'not-typescript-module',
  'module-reference',
  'syntax-error',
  'shared-file',
])
export type ShortcutClause = typeof ShortcutClause.Type

export const ShortcutTree = S.Literals(['original', 'mutated'])
export type ShortcutTree = typeof ShortcutTree.Type

const ImporterShortcutTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/ImporterShortcutDecision',
)
type ImporterShortcutTypeId = typeof ImporterShortcutTypeId

export class ShortcutTaken extends S.TaggedClass<ShortcutTaken>()('ShortcutTaken', {}) {
  readonly [ImporterShortcutTypeId] = ImporterShortcutTypeId
}

export class ImportersRechecked extends S.TaggedClass<ImportersRechecked>()('ImportersRechecked', {
  clause: ShortcutClause,
  tree: ShortcutTree,
}) {
  readonly [ImporterShortcutTypeId] = ImporterShortcutTypeId
}

export const ImporterShortcutDecision = S.Union([ShortcutTaken, ImportersRechecked])
export type ImporterShortcutDecision = typeof ImporterShortcutDecision.Type

export const takesShortcut = (decision: ImporterShortcutDecision): boolean => S.is(ShortcutTaken)(decision)

const fallbackKeyOf = (decision: ImporterShortcutDecision): Option.Option<string> =>
  Match.valueTags(decision, {
    ShortcutTaken: () => Option.none<string>(),
    ImportersRechecked: (rechecked) => Option.some(`${rechecked.tree}.${rechecked.clause}`),
  })

export const ShortcutOutcomes = S.Struct({
  importerCheck: ImporterCheck,
  decisions: ImporterShortcutDecision.pipe(S.Option, S.Array),
})
export type ShortcutOutcomes = typeof ShortcutOutcomes.Type

const SHORTCUT_COUNT = 'typescript.importer_shortcut.count'

const outcomeFallbackKeyOf = (decision: Option.Option<ImporterShortcutDecision>): Option.Option<string> =>
  Option.match(decision, { onNone: () => Option.some('unread'), onSome: fallbackKeyOf })

const locationRuleCountsOf = (
  decisions: ReadonlyArray<Option.Option<ImporterShortcutDecision>>,
): Readonly<Record<string, number>> => ({
  [SHORTCUT_COUNT]: Arr.filter(decisions, (decision) => Option.exists(decision, takesShortcut)).length,
  ...Object.fromEntries(
    Object.entries(Arr.groupBy(Arr.getSomes(Arr.map(decisions, outcomeFallbackKeyOf)), (key) => key))
      .map(([key, keys]) => [`typescript.importer_shortcut.fallback.${key}.count`, keys.length]),
  ),
})

export const shortcutCountsOf = (outcomes: ShortcutOutcomes): Readonly<Record<string, number>> =>
  Boolean.match(readsEditSites(outcomes.importerCheck), {
    onFalse: () => ({ [SHORTCUT_COUNT]: 0 }),
    onTrue: () => locationRuleCountsOf(outcomes.decisions),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀d_TakesShortcut_≡OnlyForTheTakenTag',
    { of: [ImporterShortcutDecision], subject: takesShortcut },
    (subject, [decision]) =>
      subject(decision) === Match.valueTags(decision, { ShortcutTaken: () => true, ImportersRechecked: () => false }),
  )

  it.prop(
    '∀d_FallbackKeyOf_≡NoneForTheShortcutTreeThenClauseForARecheck',
    { of: [ImporterShortcutDecision], subject: fallbackKeyOf },
    (subject, [decision]) =>
      Option.match(subject(decision), {
        onNone: () => S.is(ShortcutTaken)(decision),
        onSome: (key) =>
          Option.exists(
            Option.liftPredicate(S.is(ImportersRechecked))(decision),
            (rechecked) => key.split('.').join(' ') === `${rechecked.tree} ${rechecked.clause}`,
          ),
      }),
  )

  const countOf = (counts: Readonly<Record<string, number>>, key: string): number => counts[key] ?? 0
  const taken = (decisions: ShortcutOutcomes['decisions']): number =>
    Arr.filter(decisions, (decision) => Option.exists(decision, S.is(ShortcutTaken))).length

  const eachOutcomeCountedOnce = (
    counts: Readonly<Record<string, number>>,
    decisions: ShortcutOutcomes['decisions'],
  ): boolean =>
    Arr.every([
      Arr.reduce(Object.values(counts), 0, (total, count) => total + count) === decisions.length,
      countOf(counts, 'typescript.importer_shortcut.count') === taken(decisions),
      countOf(counts, 'typescript.importer_shortcut.fallback.unread.count') ===
        Arr.filter(decisions, Option.isNone).length,
    ], (holds) => holds)

  it.prop(
    '∀o_ShortcutCountsOf_≡EachOutcomeCountedOnceUnderTheLocationRuleElseOnlyAZeroShortcutCount',
    { of: [ShortcutOutcomes], subject: shortcutCountsOf },
    (subject, [outcomes]) => {
      const counts = subject(outcomes)
      return Boolean.match(readsEditSites(outcomes.importerCheck), {
        onTrue: () => eachOutcomeCountedOnce(counts, outcomes.decisions),
        onFalse: () => JSON.stringify(counts) === JSON.stringify({ 'typescript.importer_shortcut.count': 0 }),
      })
    },
  )
}
