import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CompileGlobTypeId = Symbol.for('@systemfsoftware/stryker-js/CompileGlobDecision')
type CompileGlobTypeId = typeof CompileGlobTypeId

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

export class GlobMatcher extends S.TaggedClass<GlobMatcher>()('GlobMatcher', {
  source: S.String,
  flags: S.String,
}) {
  readonly [CompileGlobTypeId] = CompileGlobTypeId
}

export class GlobUnmatchable extends S.TaggedClass<GlobUnmatchable>()('GlobUnmatchable', {
  pattern: S.Union([S.Boolean, S.String]),
}) {
  readonly [CompileGlobTypeId] = CompileGlobTypeId
}

export class CompileGlobCommand extends S.TaggedClass<CompileGlobCommand>()('CompileGlobCommand', {
  pattern: S.Union([S.Boolean, S.String]),
  caseInsensitive: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const CompileGlobDecision = S.Union([GlobMatcher, GlobUnmatchable])
export type CompileGlobDecision = typeof CompileGlobDecision.Type

const matcherOf = (pattern: string, caseInsensitive: boolean): GlobMatcher =>
  GlobMatcher.make({
    source: `^${globSegmentToRegex(pattern)}$`,
    flags: Boolean.match(caseInsensitive, { onTrue: (): string => 'i', onFalse: (): string => '' }),
  })

const decisionOf = (command: CompileGlobCommand): CompileGlobDecision =>
  Match.value(command.pattern).pipe(
    Match.withReturnType<CompileGlobDecision>(),
    Match.when(Match.string, (value) => matcherOf(value, command.caseInsensitive)),
    Match.orElse(() => GlobUnmatchable.make({ pattern: command.pattern })),
  )

export const compileGlob = Workflow.make({
  command: CompileGlobCommand,
  decision: CompileGlobDecision,
  error: S.Never,
  decide: (command: CompileGlobCommand): Result.Result<CompileGlobDecision, never> =>
    Result.succeed(decisionOf(command)),
})
