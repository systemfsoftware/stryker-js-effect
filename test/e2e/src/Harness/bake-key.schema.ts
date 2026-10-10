import { Schema } from 'effect'

export const PackedPackage = Schema.Struct({
  name: Schema.String,
  fileName: Schema.String,
  tarballPath: Schema.String,
})

export type PackedPackage = typeof PackedPackage.Type

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

export const FixtureKeys = Schema.Record(Schema.String, Schema.String)

export type FixtureKeys = typeof FixtureKeys.Type

export const BakeOutcome = Schema.Struct({
  root: Schema.String,
  keys: FixtureKeys,
  lease: Schema.String,
  baked: Schema.Number,
  locks: FixtureKeys,
})

export type BakeOutcome = typeof BakeOutcome.Type
