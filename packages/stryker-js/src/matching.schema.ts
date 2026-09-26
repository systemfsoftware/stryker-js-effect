import { Boolean } from 'effect'
import * as S from 'effect/Schema'

export class FileMatcher extends S.Class<FileMatcher>('FileMatcher')({
  pattern: S.Union([S.Boolean, S.String]),
  allowHiddenFiles: S.Boolean,
}) {}

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
