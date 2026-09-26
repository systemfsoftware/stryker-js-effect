import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'
import { LocationSchema, type Position } from './Location.schema.js'
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
    return Boolean.match(this.message.length === 0, {
      onTrue: () => 'Instrumenter failure',
      onFalse: () => this.message,
    })
  }
}
export const MutateDescriptionSchema = S.Union([S.Boolean, S.Array(LocationSchema)])

export type MutateDescription = typeof MutateDescriptionSchema.Type

export interface MutationRange {
  readonly start: Position
  readonly end: Position
}

export interface FileDescription {
  readonly mutate: MutateDescription
}

export type FileDescriptions = Record<string, FileDescription>

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
  optInMutations: S.String.pipe(S.Array, S.optional),
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
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

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

export class NodeWithoutSpan extends S.TaggedError<NodeWithoutSpan>()('NodeWithoutSpan', {
  fileName: S.String,
}) {}

export class MutantsUnplaced extends S.TaggedError<MutantsUnplaced>()('MutantsUnplaced', {
  fileName: S.String,
  detail: S.String,
}) {}

export class PlacementRefused extends S.TaggedError<PlacementRefused>()('PlacementRefused', {
  message: S.String,
}) {}
