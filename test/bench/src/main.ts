import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import {
  abortedOutcomeOf,
  type BenchAbortCode,
  type BenchCorpus,
  BenchCorpusJson,
  type BenchCorpusName,
  BenchReport,
  BenchReportJson,
  type BenchRun,
  type BenchSide,
  renderBenchReport,
  RenderBenchReportCommand,
  type SetupStep,
} from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchOrchestrationFailed } from './bench-failure.schema.js'
import { BenchTarget } from './bench-target.schema.js'
import { prepareSide } from './prepare-side.service.js'
import { runBench } from './run-bench.service.js'

const BENCH_WORK_DIR = 'bench-work'
const BENCH_RUNS_DIR = 'bench-runs'
const BENCH_REPORT_DIR = 'bench-report'
const BENCH_REPORT_FILE = 'bench-report.json'
const CORPUS_FILE = ['test', 'bench', 'corpus.json'] as const
const TURBO_CACHE_DIR = ['.turbo', 'cache'] as const
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000
const UNKNOWN_SHA = 'unknown'

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
  readonly baseSha: string
  readonly headSha: string
  readonly entry: string
  readonly deadlineMs: number
  readonly setupTimingsFile: string
  readonly runnerTemp: string
  readonly stepSummary: string
  readonly runTimeoutMs: number
}

const benchEnv = Effect.all({
  sideARoot: Config.String('BENCH_SIDE_A'),
  sideBRoot: Config.String('BENCH_SIDE_B'),
  baseSha: Config.String('BENCH_BASE_SHA'),
  headSha: Config.String('BENCH_HEAD_SHA'),
  entry: Config.String('BENCH_ENTRY'),
  deadlineMs: Config.Number('BENCH_DEADLINE_MS'),
  setupTimingsFile: Config.String('BENCH_SETUP_TIMINGS'),
  runnerTemp: Config.String('RUNNER_TEMP'),
  stepSummary: Config.String('GITHUB_STEP_SUMMARY'),
  runTimeoutMs: Config.Number('BENCH_RUN_TIMEOUT_MS').pipe(Config.withDefault(DEFAULT_RUN_TIMEOUT_MS)),
})

const abortedReport = (env: Pick<BenchEnv, 'baseSha' | 'headSha'>, code: BenchAbortCode, reason: string) =>
  BenchReport.make({
    schemaVersion: '1.0',
    baseSha: env.baseSha,
    headSha: env.headSha,
    outcome: abortedOutcomeOf(code, reason),
    runs: [],
    setupSteps: [],
  })

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

const bench = (env: BenchEnv) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

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

    const setupSteps = yield* readSetupSteps(fs, env.setupTimingsFile)
    const workRoot = path.join(env.runnerTemp, BENCH_WORK_DIR)
    const runsRoot = path.join(env.runnerTemp, BENCH_RUNS_DIR)
    const turboCacheDir = path.join(env.sideBRoot, ...TURBO_CACHE_DIR)
    const fixtureSource = path.join(env.sideBRoot, corpus.enterprise.fixture)

    const prepareNamed = (side: BenchSide, root: string, workDir: string) =>
      prepareSide({ side, root, fixtureSource, workDir: path.join(workRoot, workDir), target, turboCacheDir }).pipe(
        Effect.mapError((failure) => orchestrationFailed('side-setup-failed', `side ${side}: ${failure.message}`)),
      )
    const setupBudgetMs = Math.max(0, env.deadlineMs - (yield* Clock.currentTimeMillis))
    const prepared = yield* Effect.all({
      sideA: prepareNamed('A', env.sideARoot, 'a'),
      sideB: prepareNamed('B', env.sideBRoot, 'b'),
    }).pipe(
      Effect.timeoutOption(Duration.millis(setupBudgetMs)),
      Effect.flatMap(Option.match({
        onNone: () =>
          Effect.fail(orchestrationFailed(
            'setup-timed-out',
            `setup of both sides did not finish before the job deadline (${
              (setupBudgetMs / 1000).toFixed(1)
            }s were left when it started); no run started`,
          )),
        onSome: Effect.succeed,
      })),
    )

    const result = yield* runBench({
      corpus: corpusNameOf(target),
      entry: env.entry,
      sideA: prepared.sideA,
      sideB: prepared.sideB,
      runsRoot,
      setupSteps: [...prepared.sideA.setupSteps, ...prepared.sideB.setupSteps, ...setupSteps],
      baseSha: env.baseSha,
      headSha: env.headSha,
      runTimeoutMs: env.runTimeoutMs,
      deadlineMs: env.deadlineMs,
    })
    yield* Effect.forEach(result.runs, (run) => Console.log(runLogLine(run)))
    return result.report
  }).pipe(
    Effect.catchTag(
      'BenchOrchestrationFailed',
      (failure) => Effect.succeed(abortedReport(env, failure.code, failure.reason)),
    ),
    Effect.catchDefect((defect) => Effect.succeed(abortedReport(env, 'defect', Cause.pretty(Cause.die(defect))))),
  )

const writeReport = (env: BenchEnv, report: BenchReport) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const reportPath = path.join(env.runnerTemp, BENCH_REPORT_DIR, BENCH_REPORT_FILE)
    yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true })
    yield* fs.writeFileString(reportPath, yield* S.encodeEffect(BenchReportJson)(report))
    return yield* S.decodeEffect(BenchReportJson)(yield* fs.readFileString(reportPath))
  }).pipe(
    Effect.catch((failure) =>
      Effect.succeed(
        abortedReport(
          env,
          'report-unwritable',
          `the bench report could not be written or read back: ${failure.message}`,
        ),
      )
    ),
  )

const failExit = Effect.sync(() => {
  globalThis.process.exitCode = 1
})

const publish = (report: BenchReport, stepSummary: Option.Option<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const rendered = Result.merge(renderBenchReport(RenderBenchReportCommand.make({ report })))
    yield* Option.match(stepSummary, {
      onNone: () => Effect.void,
      onSome: (file) => fs.writeFileString(file, `${rendered.markdown}\n`, { flag: 'a' }).pipe(Effect.ignore),
    })
    yield* Console.log(rendered.annotationLine)
    yield* Match.valueTags(report.outcome, {
      summarized: () => Effect.void,
      failed: () => failExit,
      aborted: () => failExit,
    })
  })

const program = Effect.gen(function*() {
  const env = yield* Effect.result(benchEnv)
  yield* Result.match(env, {
    onFailure: (error) =>
      publish(
        abortedReport({ baseSha: UNKNOWN_SHA, headSha: UNKNOWN_SHA }, 'environment-incomplete', error.message),
        Option.none(),
      ),
    onSuccess: (present) =>
      bench(present).pipe(
        Effect.flatMap((report) => writeReport(present, report)),
        Effect.flatMap((report) => publish(report, Option.some(present.stepSummary))),
      ),
  })
})

NodeRuntime.runMain({ disableErrorReporting: true })(program.pipe(Effect.provide(nodeServicesLayer)))
