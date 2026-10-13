import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Function from 'effect/Function'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRunInvalid, BenchRunKey, WorkloadDigest } from './bench-run.schema.js'
import { BenchProjectSummary, Regression } from './bench-summary.schema.js'

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

export const LegTime = S.TaggedUnion({
  LegMeasured: { wallMs: Report.NonNegativeFinite, targetMs: LegTargetMs },
  LegNotMeasured: { targetMs: LegTargetMs },
})
export type LegTime = typeof LegTime.Type

export const BenchAbortCode = S.Literals([
  'environment-incomplete',
  'corpus-unreadable',
  'setup-timings-malformed',
  'entry-unknown',
  'side-setup-failed',
  'report-unwritable',
  'run-path-occupied',
  'run-path-move-failed',
  'run-path-unrestored',
  'defect',
])
export type BenchAbortCode = typeof BenchAbortCode.Type

const NEXT_ACTION: { readonly [C in BenchAbortCode]: string } = {
  'environment-incomplete':
    'set the missing variables where bench.yml sets them (the Bench step env, or GITHUB_ENV for JOB_STARTED_AT; the runner sets RUNNER_TEMP and GITHUB_STEP_SUMMARY), then re-run the job',
  'corpus-unreadable':
    'fix test/bench/corpus.json so it decodes as BenchCorpusJson; the next main commit benches with the fix',
  'setup-timings-malformed': 'fix the step in bench.yml that appends tab-separated "name<TAB>ms" lines, then re-run',
  'entry-unknown':
    'name a repo project or the enterprise fixture listed in test/bench/corpus.json in BENCH_ENTRY; the plan job derives the matrix from that file, so re-run the whole workflow',
  'side-setup-failed':
    'read the failing step and output tail in the reason; rerun that step command in the named side checkout',
  'report-unwritable': 'check free space and permissions under RUNNER_TEMP on the runner, then re-run the job',
  'run-path-occupied':
    'something already sits at the run path under RUNNER_TEMP before a side moved in (a stray tree or a run that never moved back): read the reason for the path and the side, find what left it in the job log, then re-run the job',
  'run-path-move-failed':
    "RUNNER_TEMP could not be listed, a side's tree could not be renamed to the run path, or a side's working directory or CLI lies outside its tree: read the reason; an OS error (permissions, no space, a rename across filesystems) needs a runner fix, a path outside the tree is a bench bug in side setup; then re-run the job",
  'run-path-unrestored':
    "a side's tree could not be moved back from the run path to its home after a run: read the reason for both paths, the rename error and the run's own error, then re-run the job",
  'defect': 'a bench bug: open an issue with this job log, the stack above, and the base and head SHAs',
}

export const BenchReportOutcome = S.TaggedUnion({
  summarized: { projects: S.Array(BenchProjectSummary), regression: Regression },
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
  ref: S.NonEmptyString,
  leg: LegTime,
  outcome: BenchReportOutcome,
  runs: S.Array(BenchReportRun),
  setupSteps: S.Array(SetupStep),
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

const acceptsLegTarget = (ms: number): boolean => Result.isSuccess(S.decodeUnknownResult(LegTargetMs)(ms))

const acceptsReportRef = (ref: string): boolean =>
  Result.isSuccess(
    S.decodeResult(BenchReport)({
      schemaVersion: '2.0',
      baseSha: 'base',
      headSha: 'head',
      ref,
      leg: { _tag: 'LegNotMeasured', targetMs: 600_000 },
      outcome: { _tag: 'failed', invalid: [] },
      runs: [],
      setupSteps: [],
    }),
  )

const acceptsAbortCode = (code: string): boolean => Result.isSuccess(S.decodeUnknownResult(BenchAbortCode)(code))

const renderedExitVerdicts = (exitCode: number): ReadonlyArray<boolean> => [
  Result.isSuccess(
    S.decodeUnknownResult(BenchRenderedNotice)({ _tag: 'notice', annotationLine: 'a', markdown: 'm', exitCode }),
  ),
  Result.isSuccess(
    S.decodeUnknownResult(BenchRenderedError)({ _tag: 'error', annotationLine: 'a', markdown: 'm', exitCode }),
  ),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀n_LegTargetRefusal_≡TenMinutesInMilliseconds',
    { of: [S.Finite], subject: acceptsLegTarget },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append([0, 599_999, 600_000, 600_001, 600, Number.NaN], drawn),
        (ms) => subject(ms) === (ms === 10 * 60 * 1000),
      ),
  )

  it.prop(
    '∀s_BenchReportRefRefusal_≡RefusesOnlyTheEmptyRef',
    { of: [S.String], subject: acceptsReportRef },
    (subject, [drawn]) =>
      Arr.every(Arr.append(['', ' ', 'refs/heads/main'], drawn), (ref) => subject(ref) === ref.length > 0),
  )

  it.prop(
    '∀s_BenchAbortCodeRefusal_≡ExactlyTheCodesWithANextAction',
    { of: [S.String], subject: acceptsAbortCode },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', 'setup-timed-out', 'budget-exceeded', 'toString', ...Object.keys(NEXT_ACTION)], drawn),
        (code) => subject(code) === Object.hasOwn(NEXT_ACTION, code),
      ),
  )

  it.prop(
    '∀n_RenderedExitCodeRefusal_≡ProcessSuccessOrFailure',
    { of: [S.Finite], subject: renderedExitVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append([-1, 0, 1, 2, 0.5, Number.NaN], drawn),
        (exitCode) => Arr.every(subject(exitCode), (accepted) => accepted === (exitCode === 0 || exitCode === 1)),
      ),
  )
}
