import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { BenchRunInvalid, BenchRunKey } from './bench-run.schema.js'
import { BenchProjectSummary } from './bench-summary.schema.js'

export const SetupStep = S.Struct({ name: S.String, ms: Report.NonNegativeFinite })
export type SetupStep = typeof SetupStep.Type

export const BenchReportRun = S.Struct({
  key: BenchRunKey,
  wallMs: Report.NonNegativeFinite,
  exitCode: S.Int,
})
export type BenchReportRun = typeof BenchReportRun.Type

export const BenchReportOutcome = S.TaggedUnion({
  summarized: { projects: S.Array(BenchProjectSummary) },
  failed: { invalid: S.Array(BenchRunInvalid) },
})
export type BenchReportOutcome = typeof BenchReportOutcome.Type

const BenchReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchReport')
type BenchReportTypeId = typeof BenchReportTypeId

export class BenchReport extends S.Class<BenchReport>('BenchReport')({
  schemaVersion: S.Literal('1.0'),
  baseSha: S.String,
  headSha: S.String,
  outcome: BenchReportOutcome,
  runs: S.Array(BenchReportRun),
  setupSteps: S.Array(SetupStep),
}) {
  readonly [BenchReportTypeId] = BenchReportTypeId
}

export const BenchReportJson = S.fromJsonString(BenchReport)
