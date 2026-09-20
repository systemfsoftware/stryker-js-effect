import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
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

const constantFrom = <const A extends readonly [unknown, ...unknown[]]>(
  ...values: A
): Arbitrary.Arbitrary<A[number]> =>
  Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: values.length - 1 }))).pipe(
    Arbitrary.flatMap((index) => {
      const chosen = values[index]
      if (chosen === undefined) {
        throw new Error(`constantFrom was asked for a value at index ${index}, which is unbound`)
      }
      return Arbitrary.Constant(chosen)
    }),
  )

describe('admitIncrementalReport', () => {
  it.prop(
    '∀d_Brand_∈Decision',
    [
      constantFrom(
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

  it.prop('∀r_Report_≡Decision', [IncrementalReportSchema], ([report]) => {
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

  it.prop('∀r_Missing_≡Discard', [Arbitrary.Constant(undefined)], ([report]) => {
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
