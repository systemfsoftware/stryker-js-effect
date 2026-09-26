import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { admitFileMatch, FileMatchCommand, FileMatched } from './admit-file-match.workflow.js'

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

export class FileMatcher extends S.Class<FileMatcher>('FileMatcher')({
  pattern: S.Union([S.Boolean, S.String]),
  allowHiddenFiles: S.Boolean,
}) {
  matches(pathService: Path.Path, fileName: string): boolean {
    const resolvedFileName = pathService.resolve(fileName).replace(/\\/g, '/')
    const resolvedPattern = Match.value(this.pattern).pipe(
      Match.withReturnType<boolean | string>(),
      Match.when(Match.string, (value) => pathService.resolve(value).replace(/\\/g, '/')),
      Match.when(true, () => DEFAULT_GLOB),
      Match.orElse(() => false),
    )
    return Option.exists(
      Result.getSuccess(
        admitFileMatch(
          FileMatchCommand.make({ resolvedPattern, allowHiddenFiles: this.allowHiddenFiles, resolvedFileName }),
        ),
      ),
      S.is(FileMatched),
    )
  }
}

export class RelativeNormalizedFileName extends S.Class<RelativeNormalizedFileName>('RelativeNormalizedFileName')({
  fileName: S.String,
}) {
  static readonly fromAbsolute = (fileName: string | undefined, basePath: string) => {
    const raw = fileName ?? ''
    return RelativeNormalizedFileName.make({
      fileName: Boolean.match(raw.startsWith(basePath), {
        onTrue: () => raw.slice(basePath.length).replace(/^\/+/, ''),
        onFalse: () => raw,
      }).replace(/\\/g, '/'),
    })
  }
}
