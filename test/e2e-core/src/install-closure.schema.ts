import * as S from 'effect/Schema'

const EdgeSpecs = S.optional(S.Record(S.String, S.String))

const PeerDependenciesMeta = S.optional(S.Record(S.String, S.Struct({ optional: S.optional(S.Boolean) })))

export const PackedManifest = S.Struct({
  name: S.String,
  dependencies: EdgeSpecs,
  peerDependencies: EdgeSpecs,
  peerDependenciesMeta: PeerDependenciesMeta,
  optionalDependencies: EdgeSpecs,
})
export type PackedManifest = typeof PackedManifest.Type

export const PackedMember = S.Struct({ tarballPath: S.String, manifest: PackedManifest })
export type PackedMember = typeof PackedMember.Type

export const FixtureManifest = S.Struct({
  dependencies: EdgeSpecs,
  devDependencies: EdgeSpecs,
  peerDependencies: EdgeSpecs,
  peerDependenciesMeta: PeerDependenciesMeta,
  optionalDependencies: EdgeSpecs,
})
export type FixtureManifest = typeof FixtureManifest.Type

export const StagedFixtureManifest = S.Struct({ path: S.String, manifest: FixtureManifest })
export type StagedFixtureManifest = typeof StagedFixtureManifest.Type
