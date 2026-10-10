import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Instrumenter } from '@systemfsoftware/stryker-js-contracts'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import { MutatorNameSchema } from './directives/directive.schema.js'
import type { MutatorSelection } from './Mutator.service.js'

export const FileSchema = S.Struct({
  name: Mutant.CanonicalFileName,
  content: S.String,
  mutate: Instrumenter.MutateDescriptionSchema,
})

const IgnorerSchema = S.Unknown

export const InstrumenterOptionsSchema = S.Struct({
  excludedMutations: S.Array(MutatorNameSchema),
  ignorers: S.Array(IgnorerSchema),
  mutators: S.Unknown,
  mutantSetPolicy: Options.MutantSetPolicy,
  noHeader: S.optional(S.Boolean),
})
export type InstrumenterOptions = Omit<typeof InstrumenterOptionsSchema.Type, 'mutators'> & {
  readonly mutators: MutatorSelection
}

export class InstrumentFilesCommand extends S.TaggedClass<InstrumentFilesCommand>()('InstrumentFilesCommand', {
  fileCount: S.Finite,
  claimedCount: S.Finite,
  skipped: S.Array(Instrumenter.InstrumentFileSkip),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class InstrumentResult extends S.TaggedClass<InstrumentResult>()('InstrumentResult', {
  files: S.Array(FileSchema),
  mutants: S.Array(Mutant.Mutant),
  skipped: S.Array(Instrumenter.InstrumentFileSkip),
}) {}

export const PlacerNameSchema = S.Literals(['expression', 'statement', 'switch-case'])
export type PlacerName = typeof PlacerNameSchema.Type

export class MutantsUnapplied extends S.TaggedError<MutantsUnapplied>()('MutantsUnapplied', {
  fileName: S.String,
  placer: PlacerNameSchema,
  mutatorNames: S.Array(MutatorNameSchema),
  cause: S.Defect(),
}) {
  override get message(): string {
    return `Failed to apply ${this.mutatorNames.join(', ')} in ${this.fileName}`
  }
}

export class MutantNotApplied extends S.TaggedError<MutantNotApplied>()('MutantNotApplied', {
  fileName: S.String,
  mutatorName: MutatorNameSchema,
}) {
  override get message(): string {
    return `Could not apply the ${this.mutatorName} mutant in ${this.fileName}`
  }
}

export class NodeWithoutSpan extends S.TaggedError<NodeWithoutSpan>()('NodeWithoutSpan', {
  fileName: S.String,
}) {
  override get message(): string {
    return `Node without a span in ${this.fileName}`
  }
}

export class MutantsUnplaced extends S.TaggedError<MutantsUnplaced>()('MutantsUnplaced', {
  fileName: S.String,
  detail: S.String,
}) {
  override get message(): string {
    return `Mutants cannot be placed. This shouldn't happen! Unplaced mutants: ${this.detail}`
  }
}

export class PlacementRefused extends S.TaggedError<PlacementRefused>()('PlacementRefused', {
  message: S.String,
}) {}
