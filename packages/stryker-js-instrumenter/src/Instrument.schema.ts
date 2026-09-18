import * as S from 'effect/Schema'
import { Mutant } from './Mutant.schema.js'

export class InstrumentError
  extends S.TaggedError<InstrumentError>('@systemfsoftware/stryker-js-instrumenter/Instrument.schema/InstrumentError')(
    'InstrumentError',
    {
      message: S.String,
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    if (this.message.length === 0) {
      return 'Instrumenter failure'
    }
    return this.message
  }
}

const PositionSchema = S.Struct({
  line: S.Finite,
  column: S.Finite,
})

const RangeSchema = S.Struct({
  start: PositionSchema,
  end: PositionSchema,
})

export const MutateDescriptionSchema = S.Union([S.Boolean, S.Array(RangeSchema)])

export type MutateDescription = typeof MutateDescriptionSchema.Type
export type Position = typeof PositionSchema.Type

export const FileSchema = S.Struct({
  name: S.String,
  content: S.String,
  mutate: MutateDescriptionSchema,
})

const IgnorerSchema = S.Unknown

const InstrumenterOptionsSchema = S.Struct({
  excludedMutations: S.Array(S.String),
  ignorers: S.Array(IgnorerSchema),
  noHeader: S.optional(S.Boolean),
})

export type InstrumenterOptions = typeof InstrumenterOptionsSchema.Type

export class InstrumentResult extends S.TaggedClass<InstrumentResult>()('InstrumentResult', {
  files: S.Array(FileSchema),
  mutants: S.Array(Mutant),
}) {}
