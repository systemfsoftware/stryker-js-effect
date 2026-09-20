import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import {
  admitIncrementalReport,
  AdmitIncrementalReportCommand,
  IncrementalReportDiscard,
  IncrementalReportKeep,
} from '../admit-incremental-report.workflow.js'
import { IncrementalReportSchema } from '../IncrementalReport.schema.js'

const IncrementalReportDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/IncrementalReportDecision',
)

const EXPECTED_VERSION = '8.0.0'

type DecodedReport = typeof IncrementalReportSchema.Type

const sampleReport: DecodedReport = {
  incrementalVersion: EXPECTED_VERSION,
  schemaVersion: '1.0',
  thresholds: { high: 80, low: 60 },
  files: {},
}

describe('admitIncrementalReport', () => {
  it.prop(
    '∀d_Brand_∈Decision',
    [
      fc.constantFrom(
        AdmitIncrementalReportCommand.make({ report: sampleReport, expectedVersion: EXPECTED_VERSION }),
        AdmitIncrementalReportCommand.make({ report: undefined, expectedVersion: EXPECTED_VERSION }),
      ),
    ],
    ([command]) => {
      const result = admitIncrementalReport(command)
      if (!Result.isSuccess(result)) {
        return false
      }
      return Object.getOwnPropertySymbols(result.success).includes(IncrementalReportDecisionTypeId)
    },
  )

  it.prop('∀r_Report_≡Decision', [S.toArbitrary(IncrementalReportSchema)(fc)], ([report]) => {
    const result = admitIncrementalReport(
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
  })

  it.prop('∀r_Missing_≡Discard', [fc.constant(undefined)], ([report]) => {
    const result = admitIncrementalReport(
      AdmitIncrementalReportCommand.make({ report, expectedVersion: EXPECTED_VERSION }),
    )
    return (
      Result.isSuccess(result) &&
      S.is(IncrementalReportDiscard)(result.success) &&
      result.success.actual === undefined &&
      result.success.expected === EXPECTED_VERSION
    )
  })
})
