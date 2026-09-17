import * as S from 'effect/Schema'

export const ManifestDocument = S.Record(S.String, S.Unknown)

export const ManifestDocumentJson = S.fromJsonString(ManifestDocument)
