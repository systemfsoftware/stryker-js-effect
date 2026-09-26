import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const FileMatchTypeId = Symbol.for('@systemfsoftware/stryker-js/FileMatchDecision')
type FileMatchTypeId = typeof FileMatchTypeId

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

const hasHiddenSegment = (fileName: string) => fileName.split('/').some((entry) => entry.startsWith('.'))

const matcherMatchesResolved = (
  resolvedPattern: boolean | string,
  allowHiddenFiles: boolean,
  resolvedFileName: string,
): boolean =>
  Match.value(resolvedPattern).pipe(
    Match.withReturnType<boolean>(),
    Match.when(Match.string, (normalized) =>
      Boolean.match(allowHiddenFiles, {
        onTrue: () => globToRegExp(normalized, false).test(resolvedFileName),
        onFalse: () =>
          Boolean.match(hasHiddenSegment(resolvedFileName), {
            onTrue: () => false,
            onFalse: () => globToRegExp(normalized, false).test(resolvedFileName),
          }),
      })),
    Match.orElse(() => false),
  )

export class FileMatchCommand extends S.TaggedClass<FileMatchCommand>()('FileMatchCommand', {
  resolvedPattern: S.Union([S.Boolean, S.String]),
  allowHiddenFiles: S.Boolean,
  resolvedFileName: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    allowHiddenFiles: 'stryker.file_match.allow_hidden_files',
  } as const
}

export class FileMatched extends S.TaggedClass<FileMatched>()('FileMatched', {
  resolvedFileName: S.String,
}) {
  readonly [FileMatchTypeId] = FileMatchTypeId
}

export class FileNotMatched extends S.TaggedClass<FileNotMatched>()('FileNotMatched', {
  resolvedFileName: S.String,
}) {
  readonly [FileMatchTypeId] = FileMatchTypeId
}

export const FileMatchDecision = S.Union([FileMatched, FileNotMatched])
export type FileMatchDecision = typeof FileMatchDecision.Type

export const admitFileMatch = Workflow.make({
  command: FileMatchCommand,
  decision: FileMatchDecision,
  error: S.Never,
  decide: (command): Result.Result<FileMatchDecision, never> =>
    Result.succeed(
      Boolean.match(
        matcherMatchesResolved(command.resolvedPattern, command.allowHiddenFiles, command.resolvedFileName),
        {
          onTrue: () => FileMatched.make({ resolvedFileName: command.resolvedFileName }),
          onFalse: () => FileNotMatched.make({ resolvedFileName: command.resolvedFileName }),
        },
      ),
    ),
})
