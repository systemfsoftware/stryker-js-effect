import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { ShortcutClause, ShortcutTree } from './CheckerCommands.schema.js'

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

export const fallbackKeyOf = (decision: ImporterShortcutDecision): Option.Option<string> =>
  Match.valueTags(decision, {
    ShortcutTaken: () => Option.none<string>(),
    ImportersRechecked: (rechecked) => Option.some(`${rechecked.tree}.${rechecked.clause}`),
  })
