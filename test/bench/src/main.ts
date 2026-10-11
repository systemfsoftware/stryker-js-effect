import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import {
  abortedOutcomeOf,
  BENCH_ORDER,
  type BenchAbortCode,
  type BenchCorpus,
  BenchCorpusJson,
  type BenchCorpusName,
  BenchReport,
  BenchReportJson,
  BenchReportOutcome,
  type BenchRun,
  type BenchSide,
  LegNotMeasured,
  LegTargetMs,
  type LegTime,
  measureLeg,
  MeasureLegCommand,
  provisionalReport,
  ProvisionalReportCommand,
  renderBenchReport,
  RenderBenchReportCommand,
  type SetupPoint,
  type SetupStep,
  type WithheldPins,
} from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchOrchestrationFailed } from './bench-failure.schema.js'
import { BenchTarget } from './bench-target.schema.js'
import { prepareSide, type SetupProgress } from './prepare-side.service.js'
import { runBench } from './run-bench.service.js'

const BENCH_WORK_DIR = 'bench-work'
const BENCH_RUNS_DIR = 'bench-runs'
const BENCH_REPORT_DIR = 'bench-report'
const BENCH_REPORT_FILE = 'bench-report.json'
const CORPUS_FILE = ['test', 'bench', 'corpus.json'] as const
const UNKNOWN_SHA = 'unknown'
const UNKNOWN_REF = 'unknown'

const runLogLine = (run: BenchRun): string =>
  Match.value(run).pipe(
    Match.tag(
      'measured',
      (measured) =>
        `bench run ${measured.key.label} wall ${
          (measured.wallMs / 1000).toFixed(1)
        }s exit ${measured.exitCode} mutants ${measured.mutants} testsExecuted ${measured.testsExecuted}`,
    ),
    Match.tag('invalid', (invalid) => `bench run ${invalid.key.label} invalid (${invalid.code}): ${invalid.reason}`),
    Match.exhaustive,
  )

const orchestrationFailed = (code: BenchAbortCode, reason: string): BenchOrchestrationFailed =>
  BenchOrchestrationFailed.make({ code, reason })

const malformedLine = (line: string): BenchOrchestrationFailed =>
  orchestrationFailed('setup-timings-malformed', `bench setup timings line is malformed: ${line}`)

const nonBlankLines = (text: string): ReadonlyArray<string> =>
  text.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line.trim().length > 0)

const setupStepOf = (line: string): Result.Result<SetupStep, BenchOrchestrationFailed> => {
  const [name, rawMs] = line.split('\t')
  return Result.fromOption(
    Option.flatMap(
      Option.all([Option.fromUndefinedOr(name), Option.fromUndefinedOr(rawMs)]),
      ([presentName, presentMs]) =>
        Option.map(
          Option.filter(Option.some(Number(presentMs)), Number.isFinite),
          (ms) => ({ name: presentName, ms }),
        ),
    ).pipe(Option.filter((step) => step.name.length > 0)),
    () => malformedLine(line),
  )
}

const parseSetupSteps = (text: string): Effect.Effect<ReadonlyArray<SetupStep>, BenchOrchestrationFailed> =>
  Effect.fromResult(Result.all(nonBlankLines(text).map(setupStepOf)))

const readSetupSteps = (
  fs: FileSystem.FileSystem,
  file: string,
): Effect.Effect<ReadonlyArray<SetupStep>, BenchOrchestrationFailed> =>
  fs.readFileString(file).pipe(
    Effect.option,
    Effect.flatMap((text) =>
      Option.match(text, {
        onNone: (): Effect.Effect<ReadonlyArray<SetupStep>, BenchOrchestrationFailed> => Effect.succeed([]),
        onSome: (present) => parseSetupSteps(present),
      })
    ),
  )

interface BenchEnv {
  readonly sideARoot: string
  readonly sideBRoot: string
  readonly turboCacheDir: string
  readonly baseSha: string
  readonly headSha: string
  readonly ref: string
  readonly entry: string
  readonly jobStartedAtSeconds: number
  readonly setupTimingsFile: string
  readonly runnerTemp: string
  readonly stepSummary: string
}

const benchEnv = Effect.all({
  sideARoot: Config.String('BENCH_SIDE_A'),
  sideBRoot: Config.String('BENCH_SIDE_B'),
  turboCacheDir: Config.String('BENCH_TURBO_CACHE_DIR'),
  baseSha: Config.String('BENCH_BASE_SHA'),
  headSha: Config.String('BENCH_HEAD_SHA'),
  ref: Config.String('BENCH_REF'),
  entry: Config.String('BENCH_ENTRY'),
  jobStartedAtSeconds: Config.Number('JOB_STARTED_AT'),
  setupTimingsFile: Config.String('BENCH_SETUP_TIMINGS'),
  runnerTemp: Config.String('RUNNER_TEMP'),
  stepSummary: Config.String('GITHUB_STEP_SUMMARY'),
})

const REQUIRED_VARIABLES = [
  'BENCH_SIDE_A',
  'BENCH_SIDE_B',
  'BENCH_TURBO_CACHE_DIR',
  'BENCH_BASE_SHA',
  'BENCH_HEAD_SHA',
  'BENCH_REF',
  'BENCH_ENTRY',
  'JOB_STARTED_AT',
  'BENCH_SETUP_TIMINGS',
  'RUNNER_TEMP',
  'GITHUB_STEP_SUMMARY',
] as const

const missingVariables = Effect.filter(
  REQUIRED_VARIABLES,
  (name) => Effect.map(Effect.result(Config.String(name)), Result.isFailure),
)

const environmentIncompleteOf = (missing: ReadonlyArray<string>, reason: string): BenchReportOutcome =>
  BenchReportOutcome.cases.aborted.make({
    code: 'environment-incomplete',
    reason,
    nextAction: Arr.match(missing, {
      onEmpty: () =>
        'fix the variable the reason names as invalid where bench.yml sets it (the Bench step env, or GITHUB_ENV for JOB_STARTED_AT), then re-run the job',
      onNonEmpty: (names) =>
        `the Bench step ran without ${
          names.join(', ')
        }: set them where bench.yml sets them (the Bench step env, or GITHUB_ENV for JOB_STARTED_AT; the runner sets RUNNER_TEMP and GITHUB_STEP_SUMMARY), then re-run the job`,
    }),
  })

interface Progress {
  readonly setup: SetupPoint | null
  readonly finished: ReadonlyArray<BenchRun>
  readonly setupSteps: ReadonlyArray<SetupStep>
  readonly withheldPins: ReadonlyArray<WithheldPins>
}

const SETUP_START: SetupPoint = { _tag: 'start' }

const NO_PROGRESS: Progress = { setup: SETUP_START, finished: [], setupSteps: [], withheldPins: [] }

const reportAt = (
  env: Pick<BenchEnv, 'baseSha' | 'headSha' | 'ref'>,
  leg: LegTime,
  progress: Progress,
  abort: { readonly code: BenchAbortCode; readonly reason: string } | null,
): BenchReport =>
  Result.merge(
    provisionalReport(
      ProvisionalReportCommand.make({
        baseSha: env.baseSha,
        headSha: env.headSha,
        ref: env.ref,
        leg,
        order: [...BENCH_ORDER],
        finished: [...progress.finished],
        setupSteps: [...progress.setupSteps],
        withheldPins: [...progress.withheldPins],
        setup: progress.setup,
        abort,
      }),
    ),
  ).report

const withOutcome = (report: BenchReport, outcome: BenchReportOutcome): BenchReport =>
  BenchReport.make({
    schemaVersion: report.schemaVersion,
    baseSha: report.baseSha,
    headSha: report.headSha,
    ref: report.ref,
    leg: report.leg,
    outcome,
    runs: report.runs,
    setupSteps: report.setupSteps,
    withheldPins: report.withheldPins,
  })

const legOf = (env: BenchEnv): Effect.Effect<LegTime> =>
  Effect.map(
    Clock.currentTimeMillis,
    (nowMs) => Result.merge(measureLeg(MeasureLegCommand.make({ startedAtSeconds: env.jobStartedAtSeconds, nowMs }))),
  )

const targetOf = (corpus: BenchCorpus, entry: string): Option.Option<BenchTarget> =>
  Option.orElse(
    Option.map(
      Arr.findFirst(corpus.repo, (repo) => repo.project === entry),
      (repo) => BenchTarget.cases.repo.make({ entry: repo }),
    ),
    () =>
      Option.map(
        Option.liftPredicate(corpus.enterprise, (enterprise) => enterprise.fixture === entry),
        (enterprise) => BenchTarget.cases.enterprise.make({ corpus: enterprise }),
      ),
  )

const corpusNameOf = (target: BenchTarget): BenchCorpusName =>
  Match.valueTags(target, { repo: (): BenchCorpusName => 'repo', enterprise: (): BenchCorpusName => 'enterprise' })

const annotationMessageOf = (text: string): string => text.split(/\r?\n/u)[0].replaceAll('%', '%25')

const provisionalUnwritten = (runnerTemp: string, error: string) =>
  Effect.flatMap(reportPathOf(runnerTemp), (file) =>
    Console.log(
      `::warning title=Bench provisional report::${
        annotationMessageOf(`${file} could not be written: ${error}`)
      } (the leg carries on; the final report write still decides the outcome)`,
    ))

const measure = (env: BenchEnv, progress: Ref.Ref<Progress>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const record = (update: (before: Progress) => Progress) =>
      Effect.gen(function*() {
        const now = yield* Ref.updateAndGet(progress, update)
        yield* writeReportFile(env.runnerTemp, reportAt(env, yield* legOf(env), now, null))
      }).pipe(Effect.catch((cause) => provisionalUnwritten(env.runnerTemp, cause.message)))
    yield* record((before) => before)

    const corpusPath = path.join(env.sideBRoot, ...CORPUS_FILE)
    const corpusText = yield* fs.readFileString(corpusPath).pipe(
      Effect.mapError((cause) =>
        orchestrationFailed('corpus-unreadable', `cannot read ${corpusPath}: ${cause.message}`)
      ),
    )
    const corpus = yield* S.decodeEffect(BenchCorpusJson)(corpusText).pipe(
      Effect.mapError((error) =>
        orchestrationFailed('corpus-unreadable', `${corpusPath} does not decode: ${error.message}`)
      ),
    )
    const target = yield* Effect.fromOption(targetOf(corpus, env.entry)).pipe(
      Effect.mapError(() =>
        orchestrationFailed('entry-unknown', `${corpusPath} lists no repo project or fixture ${env.entry}`)
      ),
    )

    const workflowSteps = yield* readSetupSteps(fs, env.setupTimingsFile)
    yield* Ref.update(progress, (before) => ({ ...before, setupSteps: [...workflowSteps] }))
    const workRoot = path.join(env.runnerTemp, BENCH_WORK_DIR)
    const runsRoot = path.join(env.runnerTemp, BENCH_RUNS_DIR)
    const fixtureSource = path.join(env.sideBRoot, corpus.enterprise.fixture)

    const setupProgress: SetupProgress = {
      starting: (side, step) => record((before) => ({ ...before, setup: { _tag: 'step', side, step } })),
      measured: (step) => Ref.update(progress, (before) => ({ ...before, setupSteps: [...before.setupSteps, step] })),
      withheld: (pins) =>
        Ref.update(progress, (before) => ({ ...before, withheldPins: [...before.withheldPins, pins] })),
    }

    const prepareNamed = (side: BenchSide, root: string, workDir: string) =>
      prepareSide({
        side,
        root,
        fixtureSource,
        workDir: path.join(workRoot, workDir),
        target,
        turboCacheDir: env.turboCacheDir,
        progress: setupProgress,
      }).pipe(
        Effect.mapError((failure) => orchestrationFailed('side-setup-failed', `side ${side}: ${failure.message}`)),
      )
    const prepared = yield* Effect.all({
      sideA: prepareNamed('A', env.sideARoot, 'a'),
      sideB: prepareNamed('B', env.sideBRoot, 'b'),
    })
    const writeProvisional = (finished: ReadonlyArray<BenchRun>) =>
      record((before) => ({ ...before, setup: null, finished }))
    yield* writeProvisional([])

    const result = yield* runBench({
      corpus: corpusNameOf(target),
      entry: env.entry,
      sideA: prepared.sideA,
      sideB: prepared.sideB,
      runsRoot,
      runnerTemp: env.runnerTemp,
      sha: env.headSha,
      parentSha: env.baseSha,
      ref: env.ref,
      onRunFinished: writeProvisional,
    })
    yield* Effect.forEach(result.runs, (run) => Console.log(runLogLine(run)))
    const final = reportAt(env, yield* legOf(env), yield* Ref.get(progress), null)
    return withOutcome(final, result.outcome)
  })

const abortedAt = (env: BenchEnv, progress: Ref.Ref<Progress>, code: BenchAbortCode, reason: string) =>
  Effect.gen(function*() {
    return reportAt(env, yield* legOf(env), yield* Ref.get(progress), { code, reason })
  })

const bench = (env: BenchEnv) =>
  Effect.gen(function*() {
    const progress = yield* Ref.make(NO_PROGRESS)
    return yield* measure(env, progress).pipe(
      Effect.catchTag('BenchOrchestrationFailed', (failure) => abortedAt(env, progress, failure.code, failure.reason)),
      Effect.catchDefect((defect) => abortedAt(env, progress, 'defect', Cause.pretty(Cause.die(defect)))),
    )
  })

const reportPathOf = (runnerTemp: string) =>
  Effect.map(Path.Path, (path) => path.join(runnerTemp, BENCH_REPORT_DIR, BENCH_REPORT_FILE))

const writeReportFile = (runnerTemp: string, report: BenchReport) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const reportPath = yield* reportPathOf(runnerTemp)
    yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true })
    yield* fs.writeFileString(reportPath, yield* S.encodeEffect(BenchReportJson)(report))
  })

const writeReport = (runnerTemp: string, report: BenchReport) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* writeReportFile(runnerTemp, report)
    return yield* S.decodeEffect(BenchReportJson)(yield* fs.readFileString(yield* reportPathOf(runnerTemp)))
  }).pipe(
    Effect.catch((failure) =>
      Effect.succeed(
        withOutcome(
          report,
          abortedOutcomeOf(
            'report-unwritable',
            `the bench report could not be written or read back: ${failure.message}`,
          ),
        ),
      )
    ),
  )

const publish = (report: BenchReport, stepSummary: Option.Option<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const rendered = Result.merge(renderBenchReport(RenderBenchReportCommand.make({ report })))
    yield* Option.match(stepSummary, {
      onNone: () => Effect.void,
      onSome: (file) => fs.writeFileString(file, `${rendered.markdown}\n`, { flag: 'a' }).pipe(Effect.ignore),
    })
    yield* Console.log(rendered.annotationLine)
    yield* Effect.sync(() => {
      globalThis.process.exitCode = rendered.exitCode
    })
  })

const environmentIncomplete = (reason: string) =>
  Effect.map(missingVariables, (missing) =>
    BenchReport.make({
      schemaVersion: '2.0',
      baseSha: UNKNOWN_SHA,
      headSha: UNKNOWN_SHA,
      ref: UNKNOWN_REF,
      leg: LegNotMeasured.make({ targetMs: LegTargetMs.literal }),
      outcome: environmentIncompleteOf(missing, reason),
      runs: [],
      setupSteps: [],
      withheldPins: [],
    }))

const runnerTempOf = Effect.map(Effect.result(Config.String('RUNNER_TEMP')), Result.getSuccess)

const program = Effect.gen(function*() {
  const env = yield* Effect.result(benchEnv)
  yield* Result.match(env, {
    onFailure: (error) =>
      Effect.gen(function*() {
        const report = yield* environmentIncomplete(error.message)
        const written = yield* Option.match(yield* runnerTempOf, {
          onNone: () => Effect.succeed(report),
          onSome: (runnerTemp) => writeReport(runnerTemp, report),
        })
        yield* publish(written, Option.none())
      }),
    onSuccess: (present) =>
      bench(present).pipe(
        Effect.flatMap((report) => writeReport(present.runnerTemp, report)),
        Effect.flatMap((report) => publish(report, Option.some(present.stepSummary))),
      ),
  })
})

NodeRuntime.runMain({ disableErrorReporting: true })(program.pipe(Effect.provide(nodeServicesLayer)))
