import { Schema as S } from 'effect'

export class ManifestUnreadable extends S.TaggedError<ManifestUnreadable>()('ManifestUnreadable', {
  specifier: S.String,
  cause: S.Unknown,
}) {}

export const ManifestSchema = S.Struct({ version: S.optional(S.String) })
