import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { compileGlob, CompileGlobCommand, type CompileGlobDecision, type GlobMatcher } from './compile-glob.workflow.js'

const FileMatchTypeId = Symbol.for('@systemfsoftware/stryker-js/FileMatchDecision')
type FileMatchTypeId = typeof FileMatchTypeId

const globExpression = compileGlob
const compileGlobCommand = CompileGlobCommand

const expressionOf = (pattern: boolean | string, caseInsensitive: boolean): CompileGlobDecision =>
  Result.getOrElse(globExpression(compileGlobCommand.make({ pattern, caseInsensitive })), (neverError) => neverError)

const regexpOf = (matcher: GlobMatcher): Option.Option<RegExp> =>
  Result.getSuccess(Result.try(() => new RegExp(matcher.source, matcher.flags)))

const matchesGlob = (matcher: GlobMatcher, allowHiddenFiles: boolean, resolvedFileName: string): boolean =>
  Boolean.match(allowHiddenFiles, {
    onTrue: () => Option.exists(regexpOf(matcher), (regexp) => regexp.test(resolvedFileName)),
    onFalse: () =>
      Boolean.match(hasHiddenSegment(resolvedFileName), {
        onTrue: () => false,
        onFalse: () => Option.exists(regexpOf(matcher), (regexp) => regexp.test(resolvedFileName)),
      }),
  })

const matcherMatchesResolved = (
  resolvedPattern: boolean | string,
  allowHiddenFiles: boolean,
  resolvedFileName: string,
): boolean =>
  Match.value(expressionOf(resolvedPattern, false)).pipe(
    Match.withReturnType<boolean>(),
    Match.tag('GlobMatcher', (matcher) => matchesGlob(matcher, allowHiddenFiles, resolvedFileName)),
    Match.tag('GlobUnmatchable', () => false),
    Match.exhaustive,
  )

const hasHiddenSegment = (fileName: string) => fileName.split('/').some((entry) => entry.startsWith('.'))

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
