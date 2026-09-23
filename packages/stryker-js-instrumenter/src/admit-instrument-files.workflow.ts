import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { InstrumentFilesCommand, InstrumentFileSkip } from './Instrument.schema.js'

const InstrumentFilesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/InstrumentFilesDecision',
)
type InstrumentFilesDecisionTypeId = typeof InstrumentFilesDecisionTypeId

export class InstrumentFilesAdmitted extends S.TaggedClass<InstrumentFilesAdmitted>()('InstrumentFilesAdmitted', {
  fileCount: S.Finite,
  skipped: S.Array(InstrumentFileSkip),
}) {
  readonly [InstrumentFilesDecisionTypeId] = InstrumentFilesDecisionTypeId
}

export class InstrumentFilesSkippedOnly extends S.TaggedClass<InstrumentFilesSkippedOnly>()(
  'InstrumentFilesSkippedOnly',
  {
    skipped: S.Array(InstrumentFileSkip),
  },
) {
  readonly [InstrumentFilesDecisionTypeId] = InstrumentFilesDecisionTypeId
}

export type InstrumentFilesDecision = InstrumentFilesAdmitted | InstrumentFilesSkippedOnly

const isZero = (count: number): boolean => count === 0

export const admitInstrumentFiles = Workflow.total(
  InstrumentFilesCommand,
  (command): Result.Result<InstrumentFilesDecision, never> =>
    Match.value(isZero(command.claimedCount)).pipe(
      Match.when(true, () => Result.succeed(new InstrumentFilesSkippedOnly({ skipped: command.skipped }))),
      Match.when(false, () =>
        Result.succeed(new InstrumentFilesAdmitted({ fileCount: command.fileCount, skipped: command.skipped }))),
      Match.exhaustive,
    ),
)
