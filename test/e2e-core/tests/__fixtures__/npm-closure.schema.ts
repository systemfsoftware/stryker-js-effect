import * as S from 'effect/Schema'

export const NpmManifestJson = S.fromJsonString(S.Struct({
  name: S.String,
  version: S.String,
  private: S.optional(S.Boolean),
  dependencies: S.optional(S.Record(S.String, S.String)),
}))

export const NpmLockEntry = S.Struct({
  name: S.optional(S.String),
  version: S.optional(S.String),
  resolved: S.optional(S.String),
})
export type NpmLockEntry = typeof NpmLockEntry.Type

export const NpmLockfileJson = S.fromJsonString(S.Struct({ packages: S.Record(S.String, NpmLockEntry) }))
export type NpmLockfile = typeof NpmLockfileJson.Type

const Specs = S.optional(S.Record(S.String, S.String))

export const PinnedFixtureManifestJson = S.fromJsonString(S.Struct({
  name: S.String,
  version: S.String,
  private: S.Boolean,
  devDependencies: Specs,
  overrides: Specs,
}))

export const PackumentJson = S.fromJsonString(S.Struct({
  name: S.String,
  'dist-tags': S.Record(S.String, S.String),
  versions: S.Record(
    S.String,
    S.Struct({
      name: S.String,
      version: S.String,
      dependencies: Specs,
      peerDependencies: Specs,
      dist: S.Struct({ tarball: S.String }),
    }),
  ),
  time: S.Record(S.String, S.String),
}))
