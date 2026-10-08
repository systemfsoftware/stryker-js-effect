import * as S from 'effect/Schema'

export const NpmManifestJson = S.fromJsonString(S.Struct({
  name: S.String,
  version: S.String,
  private: S.optional(S.Boolean),
  dependencies: S.optional(S.Record(S.String, S.String)),
}))

export const NpmLockEntry = S.Struct({ name: S.optional(S.String), resolved: S.optional(S.String) })
export type NpmLockEntry = typeof NpmLockEntry.Type

export const NpmLockfileJson = S.fromJsonString(S.Struct({ packages: S.Record(S.String, NpmLockEntry) }))
export type NpmLockfile = typeof NpmLockfileJson.Type
