import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const DiscoveredEntryTypeId = Symbol.for('@systemfsoftware/stryker-js/DiscoveredEntryDecision')
type DiscoveredEntryTypeId = typeof DiscoveredEntryTypeId

const escapeRegex = (value: string): string => value.replace(/[\\^$.|()+]/g, '\\$&')

const orEmpty = (value: string | undefined): string => Option.getOrElse(Option.fromUndefinedOr(value), () => '')

const globSegmentToRegex = (segment: string): string =>
  Match.value(segment.length === 0).pipe(
    Match.withReturnType<string>(),
    Match.when(true, () => ''),
    Match.orElse(() =>
      Match.value(segment.charCodeAt(0) - 42).pipe(
        Match.withReturnType<string>(),
        Match.when(0, () => {
          const rest = segment.slice(1)
          return Boolean.match(rest.startsWith('*'), {
            onTrue: () => {
              const afterStars = rest.slice(1)
              return Boolean.match(afterStars.startsWith('/'), {
                onTrue: () => `(?:(?:[^/]+/)*)?${globSegmentToRegex(afterStars.slice(1))}`,
                onFalse: () => `.*${globSegmentToRegex(afterStars)}`,
              })
            },
            onFalse: () => `[^/]*${globSegmentToRegex(rest)}`,
          })
        }),
        Match.when(21, () => `[^/]${globSegmentToRegex(segment.slice(1))}`),
        Match.when(81, () => {
          const close = segment.indexOf('}')
          return Boolean.match(close < 0, {
            onTrue: () => `${escapeRegex('{')}${globSegmentToRegex(segment.slice(1))}`,
            onFalse: () => {
              const alternatives = segment.slice(1, close).split(',').map(globSegmentToRegex).join('|')
              return `(?:${alternatives})${globSegmentToRegex(segment.slice(close + 1))}`
            },
          })
        }),
        Match.when(49, () => {
          const close = segment.indexOf(']', 1)
          return Boolean.match(close < 0, {
            onTrue: () => `${escapeRegex('[')}${globSegmentToRegex(segment.slice(1))}`,
            onFalse: () => `${segment.slice(0, close + 1)}${globSegmentToRegex(segment.slice(close + 1))}`,
          })
        }),
        Match.orElse(() => `${escapeRegex(orEmpty(segment[0]))}${globSegmentToRegex(segment.slice(1))}`),
      )
    ),
  )

const globToRegExp = (pattern: string, caseInsensitive: boolean) =>
  new RegExp(
    `^${globSegmentToRegex(pattern)}$`,
    Boolean.match(caseInsensitive, { onTrue: (): 'i' => 'i', onFalse: (): '' => '' }),
  )

interface CompiledIgnoreRule {
  readonly negate: boolean
  readonly expression: RegExp
  readonly prefix: RegExp
}

const compileIgnoreRule = (pattern: string): CompiledIgnoreRule => {
  const negate = pattern.startsWith('!')
  const body = Boolean.match(negate, { onTrue: () => pattern.slice(1), onFalse: () => pattern })
  const expression = globToRegExp(body, true)
  return {
    negate,
    expression,
    prefix: new RegExp(expression.source.replace(/\$$/, ''), expression.flags),
  }
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
