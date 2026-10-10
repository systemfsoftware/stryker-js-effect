import { Schema } from 'effect'

export const PackedPackage = Schema.Struct({
  name: Schema.String,
  fileName: Schema.String,
  tarballPath: Schema.String,
})

export type PackedPackage = typeof PackedPackage.Type

export const FixtureKeys = Schema.Record(Schema.String, Schema.String)

export type FixtureKeys = typeof FixtureKeys.Type

export const BakeOutcome = Schema.Struct({
  root: Schema.String,
  keys: FixtureKeys,
  lease: Schema.String,
  baked: Schema.Number,
  locks: FixtureKeys,
  bootSeconds: Schema.NullOr(Schema.Number),
  installSeconds: Schema.NullOr(Schema.Number),
})

export type BakeOutcome = typeof BakeOutcome.Type
