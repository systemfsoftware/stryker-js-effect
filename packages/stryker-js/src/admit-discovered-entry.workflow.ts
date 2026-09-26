import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { compileGlob, CompileGlobCommand, type CompileGlobDecision } from './compile-glob.workflow.js'

const DiscoveredEntryTypeId = Symbol.for('@systemfsoftware/stryker-js/DiscoveredEntryDecision')
type DiscoveredEntryTypeId = typeof DiscoveredEntryTypeId

const globExpression = compileGlob
const compileGlobCommand = CompileGlobCommand

const expressionOf = (pattern: boolean | string, caseInsensitive: boolean): CompileGlobDecision =>
  Result.getOrElse(globExpression(compileGlobCommand.make({ pattern, caseInsensitive })), (neverError) => neverError)

const UNMATCHABLE = /(?!)/

interface CompiledIgnoreRule {
  readonly negate: boolean
  readonly expression: RegExp
  readonly prefix: RegExp
}

const ruleOf = (negate: boolean, expression: RegExp): CompiledIgnoreRule => ({
  negate,
  expression,
  prefix: new RegExp(expression.source.replace(/\$$/, ''), expression.flags),
})

const compileIgnoreRule = (pattern: string): CompiledIgnoreRule => {
  const negate = pattern.startsWith('!')
  const body = Boolean.match(negate, { onTrue: () => pattern.slice(1), onFalse: () => pattern })
  return Match.value(expressionOf(body, true)).pipe(
    Match.withReturnType<CompiledIgnoreRule>(),
    Match.tag('GlobMatcher', (matcher) => ruleOf(negate, new RegExp(matcher.source, matcher.flags))),
    Match.tag('GlobUnmatchable', () => ruleOf(negate, UNMATCHABLE)),
    Match.exhaustive,
  )
}

const matchesDirectoryPartially = (entryPath: string, rule: CompiledIgnoreRule) =>
  [`/${entryPath}`, entryPath].some((candidate) => rule.prefix.test(candidate))

const matchesFileCandidate = (entryName: string, entryPath: string, rule: CompiledIgnoreRule) =>
  [entryName, entryPath, `/${entryPath}`].some((candidate) => rule.expression.test(candidate))

const matchesDirectoryTail = (entryPath: string, rule: CompiledIgnoreRule) =>
  [rule.expression.test(`/${entryPath}/`), rule.expression.test(`${entryPath}/`)].some((matched) => matched)

const matchesNegatedDirectory = (entryPath: string, rule: CompiledIgnoreRule) =>
  Boolean.every([rule.negate, matchesDirectoryPartially(entryPath, rule)])

const matchesDirectory = (entryName: string, entryPath: string, rule: CompiledIgnoreRule) =>
  [
    matchesFileCandidate(entryName, entryPath, rule),
    matchesDirectoryTail(entryPath, rule),
    matchesNegatedDirectory(entryPath, rule),
  ].some((matched) => matched)

const applyIgnoreRule = (included: boolean, negate: boolean, matches: () => boolean) =>
  Boolean.match(negate, {
    onTrue: () => included,
    onFalse: () => Boolean.match(matches(), { onTrue: () => negate, onFalse: () => included }),
  })

const isIncluded = (
  rules: readonly CompiledIgnoreRule[],
  name: string,
  entryPath: string,
  isDirectory: boolean,
) =>
  rules.reduce(
    (included, rule) =>
      applyIgnoreRule(included, rule.negate, () =>
        Boolean.match(isDirectory, {
          onTrue: () => matchesDirectory(name, entryPath, rule),
          onFalse: () => matchesFileCandidate(name, entryPath, rule),
        })),
    true,
  )

export class DiscoveredEntryCommand extends S.TaggedClass<DiscoveredEntryCommand>()('DiscoveredEntryCommand', {
  ignorePatterns: S.Array(S.String),
  entryName: S.String,
  entryPath: S.String,
  isDirectory: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    entryName: 'stryker.discovered_entry.name',
    isDirectory: 'stryker.discovered_entry.is_directory',
  } as const
}

export class EntryIncluded extends S.TaggedClass<EntryIncluded>()('EntryIncluded', {
  entryName: S.String,
}) {
  readonly [DiscoveredEntryTypeId] = DiscoveredEntryTypeId
}

export class EntryIgnored extends S.TaggedClass<EntryIgnored>()('EntryIgnored', {
  entryName: S.String,
}) {
  readonly [DiscoveredEntryTypeId] = DiscoveredEntryTypeId
}

export const DiscoveredEntryDecision = S.Union([EntryIncluded, EntryIgnored])
export type DiscoveredEntryDecision = typeof DiscoveredEntryDecision.Type

export const admitDiscoveredEntry = Workflow.make({
  command: DiscoveredEntryCommand,
  decision: DiscoveredEntryDecision,
  error: S.Never,
  decide: (command): Result.Result<DiscoveredEntryDecision, never> =>
    Result.succeed(
      Boolean.match(
        isIncluded(
          command.ignorePatterns.map(compileIgnoreRule),
          command.entryName,
          command.entryPath,
          command.isDirectory,
        ),
        {
          onTrue: () => EntryIncluded.make({ entryName: command.entryName }),
          onFalse: () => EntryIgnored.make({ entryName: command.entryName }),
        },
      ),
    ),
})
