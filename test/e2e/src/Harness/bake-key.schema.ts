import { Schema } from 'effect'

export const FileBytes = Schema.Struct({
  relativePath: Schema.String,
  bytes: Schema.Uint8Array,
})

export type FileBytes = typeof FileBytes.Type

export const PackedPackage = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  fileName: Schema.String,
  tarballPath: Schema.String,
})

export type PackedPackage = typeof PackedPackage.Type

export class FoundPackage extends Schema.TaggedClass<FoundPackage>()('Found', { pack: PackedPackage }) {}

export class MissingTarball extends Schema.TaggedClass<MissingTarball>()('MissingTarball', {
  prefix: Schema.String,
  directory: Schema.String,
}) {}

export class UnreadableVersion extends Schema.TaggedClass<UnreadableVersion>()('UnreadableVersion', {
  fileName: Schema.String,
}) {}

export const PackedPackageLookup = Schema.Union([FoundPackage, MissingTarball, UnreadableVersion])

export type PackedPackageLookup = typeof PackedPackageLookup.Type

export const TurboTask = Schema.Struct({
  command: Schema.optional(Schema.String),
  package: Schema.optional(Schema.String),
  taskId: Schema.String,
})

export const TurboDryRun = Schema.Struct({ tasks: Schema.Array(TurboTask) })

export class TurboClosure extends Schema.TaggedClass<TurboClosure>()('Closure', {
  packages: Schema.Array(Schema.String),
}) {}

export class MalformedClosure extends Schema.TaggedClass<MalformedClosure>()('Malformed', {}) {}

export const TurboDryClosure = Schema.Union([TurboClosure, MalformedClosure])

export type TurboDryClosure = typeof TurboDryClosure.Type

export const BakedInput = Schema.Struct({
  baseImage: Schema.String,
  bakeScript: Schema.Uint8Array,
  packs: Schema.Array(Schema.Struct({ fileName: Schema.String, files: Schema.Array(FileBytes) })),
  fixtures: Schema.Array(Schema.Struct({ fixtureId: Schema.String, files: Schema.Array(FileBytes) })),
})

export type BakedInput = typeof BakedInput.Type
