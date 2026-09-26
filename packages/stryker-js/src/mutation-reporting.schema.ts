import { Schema as S } from 'effect'

export class ManifestUnreadable extends S.TaggedError<ManifestUnreadable>()('ManifestUnreadable', {
  specifier: S.String,
  cause: S.Unknown,
}) {
  override get message(): string {
    return `Package manifest is unreadable: ${this.specifier}`
  }
}

export const ManifestSchema = S.Struct({ version: S.optional(S.String) })
