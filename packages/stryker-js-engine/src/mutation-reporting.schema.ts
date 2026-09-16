import * as S from 'effect/Schema'

export const ManifestSchema = S.Struct({ version: S.optional(S.String) })
