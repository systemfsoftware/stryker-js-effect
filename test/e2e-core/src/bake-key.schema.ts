import * as S from 'effect/Schema'

export const FileBytes = S.Struct({ relativePath: S.String, bytes: S.Uint8Array })
export type FileBytes = typeof FileBytes.Type

export const PackedTree = S.Struct({ fileName: S.String, files: S.Array(FileBytes) })
export type PackedTree = typeof PackedTree.Type

const EdgeSpecs = S.optional(S.Record(S.String, S.String))

export const PackedManifest = S.Struct({
  name: S.String,
  dependencies: EdgeSpecs,
  peerDependencies: EdgeSpecs,
  optionalDependencies: EdgeSpecs,
})
export type PackedManifest = typeof PackedManifest.Type

export const PackedMember = S.Struct({ tarballPath: S.String, manifest: PackedManifest })
export type PackedMember = typeof PackedMember.Type

export const PackInput = S.Struct({
  baseImage: S.String,
  bakeScript: S.Uint8Array,
  packs: S.Array(PackedTree),
})
export type PackInput = typeof PackInput.Type

export const FixtureInput = S.Struct({ fixtureId: S.String, files: S.Array(FileBytes) })
export type FixtureInput = typeof FixtureInput.Type

export const FixtureKeyRef = S.Struct({ fixtureId: S.String, key: S.String })
export type FixtureKeyRef = typeof FixtureKeyRef.Type
