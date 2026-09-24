import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { IncrementalReportSchema } from './IncrementalReport.schema.js'

export class AdmitIncrementalReportCommand extends S.TaggedClass<AdmitIncrementalReportCommand>()(
  'AdmitIncrementalReportCommand',
  {
    report: S.optional(IncrementalReportSchema),
    expectedVersion: S.String,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    expectedVersion: 'stryker.incremental_report.expected_version',
  } as const
}

const IncrementalReportDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/IncrementalReportDecision',
)
type IncrementalReportDecisionTypeId = typeof IncrementalReportDecisionTypeId

export class IncrementalReportKeep extends S.TaggedClass<IncrementalReportKeep>()(
  'IncrementalReportKeep',
  {
    report: IncrementalReportSchema,
  },
) {
  readonly [IncrementalReportDecisionTypeId] = IncrementalReportDecisionTypeId
}

export class IncrementalReportDiscard extends S.TaggedClass<IncrementalReportDiscard>()(
  'IncrementalReportDiscard',
  {
    actual: S.optional(S.String),
    expected: S.String,
  },
) {
  readonly [IncrementalReportDecisionTypeId] = IncrementalReportDecisionTypeId
}

export type IncrementalReportDecision = IncrementalReportKeep | IncrementalReportDiscard

const decide = (command: AdmitIncrementalReportCommand) =>
  Option.match(Option.fromUndefinedOr(command.report), {
    onNone: () =>
      IncrementalReportDiscard.make({
        actual: undefined,
        expected: command.expectedVersion,
      }),
    onSome: (report) =>
      Match.value(report.incrementalVersion === command.expectedVersion).pipe(
        Match.when(true, () => IncrementalReportKeep.make({ report })),
        Match.orElse(() =>
          IncrementalReportDiscard.make({
            actual: report.incrementalVersion,
            expected: command.expectedVersion,
          })
        ),
      ),
  })

export const admitIncrementalReport = Workflow.make({
  command: AdmitIncrementalReportCommand,
  decision: S.Union([IncrementalReportKeep, IncrementalReportDiscard]),
  error: S.Never,
  decide: (command): Result.Result<IncrementalReportDecision, never> => Result.succeed(decide(command)),
})
