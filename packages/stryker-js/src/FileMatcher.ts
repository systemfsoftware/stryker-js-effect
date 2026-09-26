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

const stripBasePath = (raw: string, basePath: string): string =>
  raw.startsWith(basePath) ? raw.slice(basePath.length).replace(/^\/+/, '') : raw

const relativeTo = (raw: string, basePath: string): string => stripBasePath(raw, basePath).replace(/\\/g, '/')

export const relativeNormalizedFileName: {
  (fileName: string | undefined, basePath: string): string
  (basePath: string): (fileName: string | undefined) => string
} = dual(2, (fileName: string | undefined, basePath: string): string => relativeTo(fileName ?? '', basePath))
