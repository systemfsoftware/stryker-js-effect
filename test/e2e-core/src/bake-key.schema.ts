import * as S from 'effect/Schema'

export const FileBytes = S.Struct({ relativePath: S.String, bytes: S.Uint8Array })
export type FileBytes = typeof FileBytes.Type

export const PackedTree = S.Struct({ fileName: S.String, files: S.Array(FileBytes) })
export type PackedTree = typeof PackedTree.Type

export const PackInput = S.Struct({
  baseImage: S.String,
  bakeScript: S.Uint8Array,
  registryCutoff: S.String,
  packs: S.Array(PackedTree),
})
export type PackInput = typeof PackInput.Type

export const FixtureInput = S.Struct({ fixtureId: S.String, files: S.Array(FileBytes) })
export type FixtureInput = typeof FixtureInput.Type

export const FixtureKeyRef = S.Struct({ fixtureId: S.String, key: S.String })
export type FixtureKeyRef = typeof FixtureKeyRef.Type
