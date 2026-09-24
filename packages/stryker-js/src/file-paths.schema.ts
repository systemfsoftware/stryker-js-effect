import { SchemaGetter } from 'effect'
import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'

export class RelativePathRequest extends S.Class<RelativePathRequest>()('RelativePathRequest', {
  fileName: S.optional(S.String),
  basePath: S.String,
}) {}

const normalizeFileName = (fileName: string): string => fileName.replaceAll('\\', '/')

const relativeOf = (request: RelativePathRequest): string => {
  const raw = request.fileName ?? ''
  return normalizeFileName(
    Boolean.match(raw.startsWith(request.basePath), {
      onTrue: () => raw.slice(request.basePath.length).replace(/^\/+/, ''),
      onFalse: () => raw,
    }),
  )
}

export const RelativeNormalizedFileName = RelativePathRequest.pipe(
  S.decodeTo(S.String, {
    decode: SchemaGetter.transform(relativeOf),
    encode: SchemaGetter.forbiddenEncoding,
  }),
)
