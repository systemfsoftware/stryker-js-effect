import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { Incremental } from '@systemfsoftware/stryker-js-contracts'
import {
  admitIncrementalReport,
  AdmitIncrementalReportCommand,
  type IncrementalReportDecision,
  IncrementalReportDiscard,
  IncrementalReportKeep,
} from '../admit-incremental-report.workflow.js'

type Admission = Result.Result<IncrementalReportDecision, never>

type Report = S.Schema.Type<typeof Incremental.IncrementalReportSchema>

const identityOf = (report: Report) => ({
  expectedIncrementalVersion: report.incrementalVersion,
  engineDigest: report.engineDigest,
  mutantSetPolicy: report.mutantSetPolicy,
  runInputsDigest: report.runInputsDigest,
})

const discardReasonOf = (result: Admission): string | undefined =>
  Result.isSuccess(result) && S.is(IncrementalReportDiscard)(result.success)
    ? result.success.reason
    : undefined

const admits = (result: Admission): boolean => Result.isSuccess(result) && S.is(IncrementalReportKeep)(result.success)

describe('admitIncrementalReport', () => {
  it.prop(
    '∀r_Report_≡KeepWhenEveryIdentityFieldMatches',
    { of: [Incremental.IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const result = subject(AdmitIncrementalReportCommand.make({ report, ...identityOf(report) }))
      return Result.isSuccess(result) &&
        S.is(IncrementalReportKeep)(result.success) &&
        result.success.report.incrementalVersion === report.incrementalVersion
    },
  )

  it.prop(
    '∀r_ReportToolVersion_≡KeepBecauseTheToolVersionIsMetadataOnly',
    { of: [Incremental.IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const bumped = { ...report, framework: { name: 'StrykerJS', version: '999.9.9' } }
      const result = subject(AdmitIncrementalReportCommand.make({ report: bumped, ...identityOf(report) }))
      return admits(result)
    },
  )

  it.prop(
    '∀r_SemanticsMismatch_≡DiscardNamingSemanticsChanged',
    { of: [Incremental.IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const result = subject(
        AdmitIncrementalReportCommand.make({
          report,
          ...identityOf(report),
          engineDigest: `${report.engineDigest}-changed`,
        }),
      )
      return discardReasonOf(result) === 'semanticsChanged'
    },
  )

  it.prop(
    '∀r_PolicyMismatch_≡DiscardNamingPolicyChanged',
    { of: [Incremental.IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const other = report.mutantSetPolicy === 'default' ? 'full' : 'default'
      const result = subject(
        AdmitIncrementalReportCommand.make({ report, ...identityOf(report), mutantSetPolicy: other }),
      )
      return discardReasonOf(result) === 'policyChanged'
    },
  )

  it.prop(
    '∀r_RunInputsMismatch_≡DiscardNamingRunInputsChanged',
    { of: [Incremental.IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const result = subject(
        AdmitIncrementalReportCommand.make({
          report,
          ...identityOf(report),
          runInputsDigest: `${report.runInputsDigest}-changed`,
        }),
      )
      return discardReasonOf(result) === 'runInputsChanged'
    },
  )

  it.prop(
    '∀r_CacheLayoutMismatch_≡DiscardNamingCacheLayoutChanged',
    { of: [Incremental.IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const result = subject(
        AdmitIncrementalReportCommand.make({
          report,
          ...identityOf(report),
          expectedIncrementalVersion: `${report.incrementalVersion}-next`,
        }),
      )
      return discardReasonOf(result) === 'cacheLayoutChanged'
    },
  )

  it.prop(
    '∀v_NoReport_≡DiscardNamingNoPriorRecord',
    { of: [Arbitrary.schema(S.String)], subject: admitIncrementalReport },
    (subject, [expectedIncrementalVersion]) => {
      const result = subject(
        AdmitIncrementalReportCommand.make({
          report: undefined,
          expectedIncrementalVersion,
          engineDigest: 'engine',
          mutantSetPolicy: 'default',
          runInputsDigest: '',
        }),
      )
      return Result.isSuccess(result) &&
        S.is(IncrementalReportDiscard)(result.success) &&
        result.success.reason === 'noPriorRecord' &&
        result.success.expected === expectedIncrementalVersion
    },
  )
})
