import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Function from 'effect/Function'
import * as S from 'effect/Schema'

import { BenchRunInvalid, BenchRunKey, WorkloadDigest } from './bench-run.schema.js'
import { BenchProjectSummary, PhaseRegression } from './bench-summary.schema.js'
import { WithheldPins } from './lockfile-pins.schema.js'

export const SetupStep = S.Struct({ name: S.String, ms: Report.NonNegativeFinite })
export type SetupStep = typeof SetupStep.Type

export const BenchReportRun = S.Struct({
  key: BenchRunKey,
  wallMs: Report.NonNegativeFinite,
  exitCode: S.Int,
  testsExecuted: Report.NonNegativeInt,
  workloadDigest: WorkloadDigest,
})
export type BenchReportRun = typeof BenchReportRun.Type

// Source: R3 of docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md (10-minute job ceiling); no compound pack names a per-job budget.
export const LegTargetMs = S.Literal(600_000)

const LegTimeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/LegTime')
type LegTimeTypeId = typeof LegTimeTypeId

export class LegMeasured extends S.TaggedClass<LegMeasured>()('LegMeasured', {
  wallMs: Report.NonNegativeFinite,
  targetMs: LegTargetMs,
}) {
  readonly [LegTimeTypeId] = LegTimeTypeId
}

export class LegNotMeasured extends S.TaggedClass<LegNotMeasured>()('LegNotMeasured', { targetMs: LegTargetMs }) {
  readonly [LegTimeTypeId] = LegTimeTypeId
}

export const LegTime = S.Union([LegMeasured, LegNotMeasured])
export type LegTime = typeof LegTime.Type

export const BenchAbortCode = S.Literals([
  'environment-incomplete',
  'corpus-unreadable',
  'setup-timings-malformed',
  'entry-unknown',
  'side-setup-failed',
  'report-unwritable',
  'defect',
])
export type BenchAbortCode = typeof BenchAbortCode.Type

const NEXT_ACTION: { readonly [C in BenchAbortCode]: string } = {
  'environment-incomplete':
    'set JOB_STARTED_AT, the BENCH_* variables, RUNNER_TEMP and GITHUB_STEP_SUMMARY the bench workflow exports, then re-run the job',
  'corpus-unreadable':
    'fix test/bench/corpus.json so it decodes as BenchCorpusJson; the next main commit benches with the fix',
  'setup-timings-malformed': 'fix the step in bench.yml that appends tab-separated "name<TAB>ms" lines, then re-run',
  'entry-unknown':
    'name a repo project or the enterprise fixture listed in test/bench/corpus.json in BENCH_ENTRY; the plan job derives the matrix from that file, so re-run the whole workflow',
  'side-setup-failed':
    'read the failing step and output tail in the reason; rerun that step command in the named side checkout',
  'report-unwritable': 'check free space and permissions under RUNNER_TEMP on the runner, then re-run the job',
  'defect': 'a bench bug: open an issue with this job log, the stack above, and the base and head SHAs',
}

export const BenchReportOutcome = S.TaggedUnion({
  summarized: { projects: S.Array(BenchProjectSummary), regression: S.NullOr(PhaseRegression) },
  failed: { invalid: S.Array(BenchRunInvalid) },
  aborted: { code: BenchAbortCode, reason: S.String, nextAction: S.NonEmptyString },
})
export type BenchReportOutcome = typeof BenchReportOutcome.Type

export const abortedOutcomeOf: {
  (reason: string): (code: BenchAbortCode) => BenchReportOutcome
  (code: BenchAbortCode, reason: string): BenchReportOutcome
} = Function.dual(
  2,
  (code: BenchAbortCode, reason: string): BenchReportOutcome =>
    BenchReportOutcome.cases.aborted.make({ code, reason, nextAction: NEXT_ACTION[code] }),
)

const BenchReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchReport')
type BenchReportTypeId = typeof BenchReportTypeId

export class BenchReport extends S.Class<BenchReport>('BenchReport')({
  schemaVersion: S.Literal('2.0'),
  baseSha: S.String,
  headSha: S.String,
  ref: S.String,
  leg: LegTime,
  outcome: BenchReportOutcome,
  runs: S.Array(BenchReportRun),
  setupSteps: S.Array(SetupStep),
  withheldPins: S.Array(WithheldPins),
}) {
  readonly [BenchReportTypeId] = BenchReportTypeId
}

export const BenchReportJson = S.fromJsonString(BenchReport)

const BenchRenderedTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchRendered')
type BenchRenderedTypeId = typeof BenchRenderedTypeId

const RenderedFields = {
  annotationLine: S.NonEmptyString,
  markdown: S.NonEmptyString,
  exitCode: S.Literals([0, 1]),
}

export class BenchRenderedNotice extends S.TaggedClass<BenchRenderedNotice>()('notice', RenderedFields) {
  readonly [BenchRenderedTypeId] = BenchRenderedTypeId
}

export class BenchRenderedError extends S.TaggedClass<BenchRenderedError>()('error', RenderedFields) {
  readonly [BenchRenderedTypeId] = BenchRenderedTypeId
}

export const BenchRendered = S.Union([BenchRenderedNotice, BenchRenderedError])
export type BenchRendered = typeof BenchRendered.Type
