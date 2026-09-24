import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class InstrumentError extends S.TaggedError<InstrumentError>()('InstrumentError', {
  stage: S.Literal('instrument'),
  reason: S.String,
}) {}

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

type InstrumentShape = 'empty' | 'inPlace' | 'ephemeral'

const commandShape = (command: InstrumentCommand): InstrumentShape =>
  Match.value(command.fileCount === 0).pipe(
    Match.when(true, (): InstrumentShape => 'empty'),
    Match.when(false, (): InstrumentShape =>
      Match.value(command.inPlace).pipe(
        Match.when(true, (): InstrumentShape => 'inPlace'),
        Match.when(false, (): InstrumentShape => 'ephemeral'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const decide = (command: InstrumentCommand): Result.Result<InstrumentDecision, InstrumentError> =>
  Match.value(commandShape(command)).pipe(
    Match.when(
      'empty',
      () => Result.fail(InstrumentError.make({ stage: 'instrument', reason: 'No files to instrument.' })),
    ),
    Match.when('inPlace', () =>
      Result.succeed(
        InPlaceInstrument.make({
          workingDirectoryHint: 'inPlace',
          backupDirectoryHint: 'backup',
          fileCount: command.fileCount,
        }),
      )),
    Match.when('ephemeral', () =>
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
  error: InstrumentError,
  decide,
})
