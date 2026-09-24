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

export const SourceLineSchema = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))
export const SourceColumnSchema = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
export const NodePositionSchema = S.Struct({
  line: S.Int,
  column: S.Int,
})

export const FileSchema = S.Struct({
  name: S.String,
  content: S.String,
  mutate: MutateDescriptionSchema,
})

const IgnorerSchema = S.Unknown

export const InstrumenterOptionsSchema = S.Struct({
  excludedMutations: S.Array(S.String),
  ignorers: S.Array(IgnorerSchema),
  noHeader: S.optional(S.Boolean),
})

export type InstrumenterOptions = typeof InstrumenterOptionsSchema.Type

export class InstrumentFileSkip extends S.TaggedClass<InstrumentFileSkip>()('InstrumentFileSkip', {
  file: S.String,
  extension: S.String,
  reason: S.String,
}) {}

export class InstrumentFilesCommand extends S.TaggedClass<InstrumentFilesCommand>()('InstrumentFilesCommand', {
  fileCount: S.Finite,
  claimedCount: S.Finite,
  skipped: S.Array(InstrumentFileSkip),
}) {}
export class InstrumentResult extends S.TaggedClass<InstrumentResult>()('InstrumentResult', {
  files: S.Array(FileSchema),
  mutants: S.Array(Mutant),
  skipped: S.Array(InstrumentFileSkip),
}) {}

export const PlacerNameSchema = S.Literals(['expression', 'statement', 'switch-case'])
export type PlacerName = typeof PlacerNameSchema.Type

export class MutantsUnapplied extends S.TaggedError<MutantsUnapplied>()('MutantsUnapplied', {
  fileName: S.String,
  placer: PlacerNameSchema,
  mutatorNames: S.Array(S.String),
  cause: S.Defect(),
}) {}

export class MutantNotApplied extends S.TaggedError<MutantNotApplied>()('MutantNotApplied', {
  fileName: S.String,
  mutatorName: S.String,
}) {}
