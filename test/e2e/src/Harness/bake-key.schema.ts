import { Schema } from 'effect'

export const FixtureKeys = Schema.Record(Schema.String, Schema.String)

export type FixtureKeys = typeof FixtureKeys.Type

export const BakeOutcome = Schema.Struct({
  root: Schema.String,
  keys: FixtureKeys,
  lease: Schema.String,
})

export type BakeOutcome = typeof BakeOutcome.Type
