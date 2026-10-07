import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { admitFileMatch, FileMatchCommand, FileMatched } from './admit-file-match.workflow.js'
import type { FileMatcher } from './matching.schema.js'

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

export const matchesFile: {
  (matcher: FileMatcher, pathService: Path.Path, fileName: string): boolean
  (pathService: Path.Path, fileName: string): (matcher: FileMatcher) => boolean
} = dual(3, (matcher: FileMatcher, pathService: Path.Path, fileName: string): boolean => {
  const resolvedFileName = pathService.resolve(fileName).replace(/\\/g, '/')
  const resolvedPattern = Match.value(matcher.pattern).pipe(
    Match.withReturnType<boolean | string>(),
    Match.when(Match.string, (value) => pathService.resolve(value).replace(/\\/g, '/')),
    Match.when(true, () => DEFAULT_GLOB),
    Match.orElse(() => false),
  )
  return Option.exists(
    Result.getSuccess(
      admitFileMatch(
        FileMatchCommand.make({ resolvedPattern, allowHiddenFiles: matcher.allowHiddenFiles, resolvedFileName }),
      ),
    ),
    S.is(FileMatched),
  )
})

const TRAILING_SEPARATORS = /[/\\]+$/
const LEADING_SEPARATORS = /^[/\\]+/
const SEPARATOR_BOUNDARY = /^[/\\]/

const withinBase = (raw: string, base: string): boolean =>
  Boolean.every([
    raw.startsWith(base),
    Boolean.or(raw === base, SEPARATOR_BOUNDARY.test(raw.slice(base.length))),
  ])

const stripBasePath = (raw: string, basePath: string): string => {
  const base = basePath.replace(TRAILING_SEPARATORS, '')
  return Option.getOrElse(
    Option.map(
      Option.liftPredicate(raw, (value) => withinBase(value, base)),
      (value) => value.slice(base.length).replace(LEADING_SEPARATORS, ''),
    ),
    () => raw,
  )
}

const relativeTo = (raw: string, basePath: string): string => stripBasePath(raw, basePath).replace(/\\/g, '/')

export const relativeNormalizedFileName: {
  (fileName: string | undefined, basePath: string): string
  (basePath: string): (fileName: string | undefined) => string
} = dual(2, (fileName: string | undefined, basePath: string): string => relativeTo(fileName ?? '', basePath))
