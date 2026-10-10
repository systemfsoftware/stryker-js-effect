import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Function from 'effect/Function'
import * as S from 'effect/Schema'

import { BenchRunInvalid, BenchRunKey, PhaseTime, WorkloadDigest } from './bench-run.schema.js'
import { BenchProjectSummary } from './bench-summary.schema.js'
import { SetupInconclusiveCode } from './setup-outcome.schema.js'

export const BenchReportSchemaVersion = S.Literal('1.2')

export const SetupStep = S.Struct({ name: S.String, ms: Report.NonNegativeFinite })
export type SetupStep = typeof SetupStep.Type

export const BenchReportRun = S.Struct({
  key: BenchRunKey,
  wallMs: Report.NonNegativeFinite,
  exitCode: S.Int,
  testsExecuted: Report.NonNegativeInt,
  workloadDigest: WorkloadDigest,
  phaseTimes: S.Array(PhaseTime),
})
export type BenchReportRun = typeof BenchReportRun.Type

export const BenchAbortCode = S.Literals([
  'environment-incomplete',
  'corpus-unreadable',
  'setup-timings-malformed',
  'entry-unknown',
  'side-setup-failed',
  'setup-timed-out',
  'budget-exceeded',
  'report-unwritable',
  'defect',
])
export type BenchAbortCode = typeof BenchAbortCode.Type

const NEXT_ACTION: { readonly [C in BenchAbortCode]: string } = {
  'environment-incomplete':
    'set the BENCH_* variables, RUNNER_TEMP and GITHUB_STEP_SUMMARY the bench workflow exports, then re-run the job',
  'corpus-unreadable': 'fix test/bench/corpus.json on the PR head so it decodes as BenchCorpusJson, then push',
  'setup-timings-malformed': 'fix the step in bench.yml that appends tab-separated "name<TAB>ms" lines, then re-run',
  'entry-unknown':
    'name a repo project or the enterprise fixture listed in test/bench/corpus.json in BENCH_ENTRY; the plan job derives the matrix from that file, so re-run the whole workflow',
  'side-setup-failed':
    'read the failing step and output tail in the reason; rerun that step command in the named side checkout',
  'setup-timed-out':
    'a setup step overran its own deadline, or the job deadline cut it off, so no run started; read the step and output tail in the reason, re-run the job, and if the same step stalls again, compare its setup timings with the last green bench-report artifact',
  'budget-exceeded':
    "the eight runs did not fit the job budget: shrink this entry's mutate ranges or testFiles in test/bench/corpus.json until a run takes well under a minute, then push",
  'report-unwritable': 'check free space and permissions under RUNNER_TEMP on the runner, then re-run the job',
  'defect': 'a bench bug: open an issue with this job log, the stack above, and the base and head SHAs',
}

const INCONCLUSIVE_NEXT_ACTION: { readonly [C in SetupInconclusiveCode]: string } = {
  'setup-external':
    'both sides failed the same setup step the same way, so the cause is outside this PR (registry, network or runner); re-run the job',
  'base-setup-failed':
    'only the base side (A) failed setup, so this PR did not cause it; re-run the job, and if the base keeps failing, fix main',
}

export const BenchReportOutcome = S.TaggedUnion({
  summarized: { projects: S.Array(BenchProjectSummary) },
  failed: { invalid: S.Array(BenchRunInvalid) },
  aborted: { code: BenchAbortCode, reason: S.String, nextAction: S.NonEmptyString },
  inconclusive: { code: SetupInconclusiveCode, step: S.NonEmptyString, reason: S.String, nextAction: S.NonEmptyString },
})
export type BenchReportOutcome = typeof BenchReportOutcome.Type

export const inconclusiveOutcomeOf: {
  (step: string, reason: string): (code: SetupInconclusiveCode) => BenchReportOutcome
  (code: SetupInconclusiveCode, step: string, reason: string): BenchReportOutcome
} = Function.dual(
  3,
  (code: SetupInconclusiveCode, step: string, reason: string): BenchReportOutcome =>
    BenchReportOutcome.cases.inconclusive.make({ code, step, reason, nextAction: INCONCLUSIVE_NEXT_ACTION[code] }),
)

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
  schemaVersion: BenchReportSchemaVersion,
  baseSha: S.String,
  headSha: S.String,
  outcome: BenchReportOutcome,
  runs: S.Array(BenchReportRun),
  setupSteps: S.Array(SetupStep),
}) {
  readonly [BenchReportTypeId] = BenchReportTypeId
}

export const BenchReportJson = S.fromJsonString(BenchReport)

const BenchRenderedTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchRendered')
type BenchRenderedTypeId = typeof BenchRenderedTypeId

const RenderedFields = { annotationLine: S.NonEmptyString, markdown: S.NonEmptyString }

export class BenchRenderedNotice extends S.TaggedClass<BenchRenderedNotice>()('notice', RenderedFields) {
  readonly [BenchRenderedTypeId] = BenchRenderedTypeId
}

export class BenchRenderedError extends S.TaggedClass<BenchRenderedError>()('error', RenderedFields) {
  readonly [BenchRenderedTypeId] = BenchRenderedTypeId
}

export class BenchRenderedWarning extends S.TaggedClass<BenchRenderedWarning>()('warning', RenderedFields) {
  readonly [BenchRenderedTypeId] = BenchRenderedTypeId
}

export const BenchRendered = S.Union([BenchRenderedNotice, BenchRenderedError, BenchRenderedWarning])
export type BenchRendered = typeof BenchRendered.Type
