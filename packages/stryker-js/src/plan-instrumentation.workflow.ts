import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class InstrumentCommand extends S.TaggedClass<InstrumentCommand>()('InstrumentCommand', {
  fileCount: S.Finite,
  inPlace: S.Boolean,
  pluginCount: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    fileCount: 'stryker.instrument.file_count',
    inPlace: 'stryker.instrument.in_place',
  } as const
}

const InstrumentDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/InstrumentDecision')
type InstrumentDecisionTypeId = typeof InstrumentDecisionTypeId

export class InPlaceInstrument extends S.TaggedClass<InPlaceInstrument>()('InPlaceInstrument', {
  workingDirectoryHint: S.String,
  backupDirectoryHint: S.String,
  fileCount: S.Finite,
}) {
  readonly [InstrumentDecisionTypeId] = InstrumentDecisionTypeId
}

export class EphemeralInstrument extends S.TaggedClass<EphemeralInstrument>()('EphemeralInstrument', {
  workingDirectoryHint: S.String,
  fileCount: S.Finite,
}) {
  readonly [InstrumentDecisionTypeId] = InstrumentDecisionTypeId
}

export type InstrumentDecision = InPlaceInstrument | EphemeralInstrument

const decide = (command: InstrumentCommand): Result.Result<InstrumentDecision, never> =>
  Match.value(command.inPlace).pipe(
    Match.when(true, () =>
      Result.succeed(
        InPlaceInstrument.make({
          workingDirectoryHint: 'inPlace',
          backupDirectoryHint: 'backup',
          fileCount: command.fileCount,
        }),
      )),
    Match.when(false, () =>
      Result.succeed(
        EphemeralInstrument.make({
          workingDirectoryHint: 'temp',
          fileCount: command.fileCount,
        }),
      )),
    Match.exhaustive,
  )

export const planInstrumentation = Workflow.make({
  command: InstrumentCommand,
  decision: S.Union([InPlaceInstrument, EphemeralInstrument]),
  error: S.Never,
  decide,
})
