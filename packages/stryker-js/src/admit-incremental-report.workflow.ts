import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { IncrementalReportSchema } from './IncrementalReport.schema.js'

export class AdmitIncrementalReportCommand extends S.TaggedClass<AdmitIncrementalReportCommand>()(
  'AdmitIncrementalReportCommand',
  {
    report: S.optional(IncrementalReportSchema),
    expectedIncrementalVersion: S.String,
    engineDigest: S.String,
    mutantSetPolicy: Options.MutantSetPolicy,
    runInputsDigest: S.String,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {
    expectedIncrementalVersion: 'stryker.incremental_report.expected_version',
    engineDigest: 'stryker.incremental_report.engine_digest',
    runInputsDigest: 'stryker.incremental_report.run_inputs_digest',
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

const IncrementalDiscardReason = S.Literals([
  'semanticsChanged',
  'policyChanged',
  'runInputsChanged',
  'cacheLayoutChanged',
  'noPriorRecord',
])
type IncrementalDiscardReason = typeof IncrementalDiscardReason.Type

export class IncrementalReportDiscard extends S.TaggedClass<IncrementalReportDiscard>()(
  'IncrementalReportDiscard',
  {
    reason: IncrementalDiscardReason,
    actual: S.optional(S.String),
    expected: S.String,
  },
) {
  readonly [IncrementalReportDecisionTypeId] = IncrementalReportDecisionTypeId
}

export type IncrementalReportDecision = IncrementalReportKeep | IncrementalReportDiscard

interface IdentityMismatch {
  readonly reason: IncrementalDiscardReason
  readonly actual: string
  readonly expected: string
  readonly matches: boolean
}

const identityMismatchesOf = (
  command: AdmitIncrementalReportCommand,
  report: typeof IncrementalReportSchema.Type,
): readonly IdentityMismatch[] => [
  {
    reason: 'cacheLayoutChanged',
    actual: report.incrementalVersion,
    expected: command.expectedIncrementalVersion,
    matches: report.incrementalVersion === command.expectedIncrementalVersion,
  },
  {
    reason: 'semanticsChanged',
    actual: report.engineDigest,
    expected: command.engineDigest,
    matches: report.engineDigest === command.engineDigest,
  },
  {
    reason: 'policyChanged',
    actual: report.mutantSetPolicy,
    expected: command.mutantSetPolicy,
    matches: report.mutantSetPolicy === command.mutantSetPolicy,
  },
  {
    reason: 'runInputsChanged',
    actual: report.runInputsDigest,
    expected: command.runInputsDigest,
    matches: report.runInputsDigest === command.runInputsDigest,
  },
]

const mismatchOptionOf = (mismatch: IdentityMismatch): Option.Option<IdentityMismatch> =>
  Option.liftPredicate(mismatch, (candidate) => !candidate.matches)

const discardOf = (
  reason: IncrementalDiscardReason,
  actual: string | undefined,
  expected: string,
) => IncrementalReportDiscard.make({ reason, actual, expected })

const decide = (command: AdmitIncrementalReportCommand) =>
  Option.match(Option.fromUndefinedOr(command.report), {
    onNone: () => discardOf('noPriorRecord', undefined, command.expectedIncrementalVersion),
    onSome: (report) =>
      Option.match(Option.firstSomeOf(identityMismatchesOf(command, report).map(mismatchOptionOf)), {
        onNone: () => IncrementalReportKeep.make({ report }),
        onSome: (mismatch) => discardOf(mismatch.reason, mismatch.actual, mismatch.expected),
      }),
  })

export const admitIncrementalReport = Workflow.make({
  command: AdmitIncrementalReportCommand,
  decision: S.Union([IncrementalReportKeep, IncrementalReportDiscard]),
  error: S.Never,
  decide: (command): Result.Result<IncrementalReportDecision, never> => Result.succeed(decide(command)),
})
