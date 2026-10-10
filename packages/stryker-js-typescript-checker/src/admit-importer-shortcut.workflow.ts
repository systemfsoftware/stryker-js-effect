import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { DecideImporterShortcutCommand, ShortcutClause, ShortcutTree } from './CheckerCommands.schema.js'
import type { EditSiteFacts, EditSpan, FunctionLikeFacts } from './edit-site.schema.js'

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

interface Verdict {
  readonly clause: ShortcutClause
  readonly tree: ShortcutTree
}

interface Pair {
  readonly original: FunctionLikeFacts
  readonly mutated: FunctionLikeFacts
}

interface Rule {
  readonly verdict: Verdict
  readonly fails: boolean
}

const editableEndOf = (facts: FunctionLikeFacts): number =>
  Boolean.match(facts.blockBody, { onTrue: () => facts.bodyEnd - 1, onFalse: () => facts.bodyEnd })

const spanInsideBody = (span: EditSpan, facts: FunctionLikeFacts): boolean =>
  Boolean.and(facts.bodyStart <= span.start, span.start + span.length <= editableEndOf(facts))

const bodiesContaining = (site: EditSiteFacts): Array<FunctionLikeFacts> =>
  Arr.filter(site.enclosing, (facts) => spanInsideBody(site.span, facts))

const bodyIndependentOf = (facts: ReadonlyArray<FunctionLikeFacts>): Array<FunctionLikeFacts> =>
  Arr.filter(facts, (facts) => facts.bodyIndependentSignature)

const matchesMutated = (original: FunctionLikeFacts, mutated: FunctionLikeFacts): boolean =>
  Boolean.and(
    Boolean.and(mutated.kind === original.kind, mutated.start === original.start),
    Boolean.and(mutated.header === original.header, mutated.bodyIndependentSignature),
  )

const matchedPairOf = (original: FunctionLikeFacts, mutated: FunctionLikeFacts): Result.Result<Pair, void> =>
  Boolean.match(matchesMutated(original, mutated), {
    onTrue: () => Result.succeed({ original, mutated }),
    onFalse: () => Result.failVoid,
  })

const matchedPairs = (
  command: DecideImporterShortcutCommand,
  candidates: ReadonlyArray<FunctionLikeFacts>,
): Array<Pair> =>
  Arr.flatMap(
    candidates,
    (original) => Arr.filterMap(command.mutated.enclosing, (mutated) => matchedPairOf(original, mutated)),
  )

const deltaOf = (command: DecideImporterShortcutCommand): number =>
  command.mutated.span.length - command.original.span.length

const bodyLengthAgrees = (pair: Pair, delta: number): boolean =>
  pair.mutated.bodyEnd - pair.mutated.bodyStart === (pair.original.bodyEnd - pair.original.bodyStart) + delta

const pairAdmitsShortcut = (command: DecideImporterShortcutCommand, pair: Pair): boolean =>
  Boolean.and(spanInsideBody(command.mutated.span, pair.mutated), bodyLengthAgrees(pair, deltaOf(command)))

const notTypescriptModule = (site: EditSiteFacts): boolean =>
  Boolean.or(Boolean.not(site.typescriptModule), site.declaresGlobal)

const rulesOf = (command: DecideImporterShortcutCommand): ReadonlyArray<Rule> => {
  const originalBodies = bodiesContaining(command.original)
  const candidates = bodyIndependentOf(originalBodies)
  const pairs = matchedPairs(command, candidates)
  return [
    {
      verdict: { clause: 'outside-function-body', tree: 'original' },
      fails: !Arr.isArrayNonEmpty(originalBodies),
    },
    {
      verdict: { clause: 'body-dependent-signature', tree: 'original' },
      fails: !Arr.isArrayNonEmpty(candidates),
    },
    {
      verdict: { clause: 'not-typescript-module', tree: 'original' },
      fails: notTypescriptModule(command.original),
    },
    {
      verdict: { clause: 'module-reference', tree: 'original' },
      fails: command.original.moduleReference,
    },
    {
      verdict: { clause: 'syntax-error', tree: 'original' },
      fails: command.original.syntaxErrors,
    },
    {
      verdict: { clause: 'not-typescript-module', tree: 'mutated' },
      fails: notTypescriptModule(command.mutated),
    },
    {
      verdict: { clause: 'module-reference', tree: 'mutated' },
      fails: command.mutated.moduleReference,
    },
    {
      verdict: { clause: 'syntax-error', tree: 'mutated' },
      fails: command.mutated.syntaxErrors,
    },
    {
      verdict: { clause: 'body-dependent-signature', tree: 'mutated' },
      fails: !Arr.isArrayNonEmpty(pairs),
    },
    {
      verdict: { clause: 'outside-function-body', tree: 'mutated' },
      fails: !Arr.some(pairs, (pair) => pairAdmitsShortcut(command, pair)),
    },
  ]
}

const decide = (command: DecideImporterShortcutCommand): Result.Result<ImporterShortcutDecision, never> =>
  Result.succeed(
    Option.match(Arr.findFirst(rulesOf(command), (rule) => rule.fails), {
      onNone: () => ShortcutTaken.make({}),
      onSome: (rule) => ImportersRechecked.make({ clause: rule.verdict.clause, tree: rule.verdict.tree }),
    }),
  )

export const admitImporterShortcut = Workflow.make({
  command: DecideImporterShortcutCommand,
  decision: ImporterShortcutDecision,
  error: S.Never,
  decide,
})
