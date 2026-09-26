import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  admitIncrementalReport,
  AdmitIncrementalReportCommand,
  IncrementalReportDiscard,
  IncrementalReportKeep,
} from '../admit-incremental-report.workflow.js'
import { IncrementalReportSchema } from '../IncrementalReport.schema.js'

const EXPECTED_VERSION = '8.0.0'

describe('admitIncrementalReport', () => {
  it.prop(
    '∀r_Report_≡Decision',
    { of: [IncrementalReportSchema], subject: admitIncrementalReport },
    (subject, [report]) => {
      const result = subject(
        AdmitIncrementalReportCommand.make({ report, expectedVersion: EXPECTED_VERSION }),
      )
      if (!Result.isSuccess(result)) {
        return false
      }
      const decision = result.success
      if (report.incrementalVersion === EXPECTED_VERSION) {
        return S.is(IncrementalReportKeep)(decision) && decision.report.incrementalVersion === EXPECTED_VERSION
      }
      return (
        S.is(IncrementalReportDiscard)(decision) &&
        decision.actual === report.incrementalVersion &&
        decision.expected === EXPECTED_VERSION
      )
    },
  )

  it.prop(
    '∀r_Missing_≡Discard',
    { of: [Arbitrary.schema(S.String)], subject: admitIncrementalReport },
    (subject, [expectedVersion]) => {
      const result = subject(
        AdmitIncrementalReportCommand.make({ report: undefined, expectedVersion }),
      )
      return (
        Result.isSuccess(result) &&
        S.is(IncrementalReportDiscard)(result.success) &&
        result.success.actual === undefined &&
        result.success.expected === expectedVersion
      )
    },
  )
})
