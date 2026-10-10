import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { BenchCorpusJson, type BenchRun, type BenchRunKey } from '@systemfsoftware/stryker-e2e-core'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchOrchestrationFailed } from './bench-failure.schema.js'
import { prepareSide } from './prepare-side.service.js'
import { runBench } from './run-bench.service.js'

interface SetupStep {
  readonly name: string
  readonly ms: number
}

const BENCH_WORK_DIR = 'bench-work'
const BENCH_RUNS_DIR = 'bench-runs'
const BENCH_REPORT_DIR = 'bench-report'
const BENCH_REPORT_FILE = 'bench-report.json'
const CORPUS_FILE = ['test', 'bench', 'corpus.json'] as const
const TURBO_CACHE_DIR = ['.turbo', 'cache'] as const

const keyText = (key: BenchRunKey): string => `${key.corpus}/${key.entry} ${key.side}@${key.position}`

const runLogLine = (run: BenchRun): string =>
  Match.value(run).pipe(
    Match.tag(
      'measured',
      (measured) =>
        `bench run ${keyText(measured.key)} wall ${
          (measured.wallMs / 1000).toFixed(1)
        }s exit ${measured.exitCode} mutants ${measured.mutants} testsExecuted ${measured.testsExecuted}`,
    ),
    Match.tag('invalid', (invalid) => `bench run ${keyText(invalid.key)} invalid: ${invalid.reason}`),
    Match.exhaustive,
  )

const malformedLine = (line: string): BenchOrchestrationFailed =>
  BenchOrchestrationFailed.make({ reason: `bench setup timings line is malformed: ${line}` })

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

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const env = yield* Effect.all({
    sideARoot: Config.String('BENCH_SIDE_A'),
    sideBRoot: Config.String('BENCH_SIDE_B'),
    baseSha: Config.String('BENCH_BASE_SHA'),
    headSha: Config.String('BENCH_HEAD_SHA'),
    setupTimingsFile: Config.String('BENCH_SETUP_TIMINGS'),
    runnerTemp: Config.String('RUNNER_TEMP'),
    stepSummary: Config.String('GITHUB_STEP_SUMMARY'),
  })

  const corpusPath = path.join(env.sideBRoot, ...CORPUS_FILE)
  const corpusText = yield* fs.readFileString(corpusPath).pipe(
    Effect.mapError((cause) =>
      BenchOrchestrationFailed.make({ reason: `cannot read ${corpusPath}: ${cause.message}` })
    ),
  )
  const corpus = yield* S.decodeEffect(BenchCorpusJson)(corpusText).pipe(
    Effect.mapError((error) =>
      BenchOrchestrationFailed.make({ reason: `${corpusPath} does not decode: ${error.message}` })
    ),
  )

  const setupSteps = yield* readSetupSteps(fs, env.setupTimingsFile)
  const workRoot = path.join(env.runnerTemp, BENCH_WORK_DIR)
  const runsRoot = path.join(env.runnerTemp, BENCH_RUNS_DIR)
  const reportPath = path.join(env.runnerTemp, BENCH_REPORT_DIR, BENCH_REPORT_FILE)
  const turboCacheDir = path.join(env.sideBRoot, ...TURBO_CACHE_DIR)
  const fixtureSource = path.join(env.sideBRoot, corpus.enterprise.fixture)

  const sideA = yield* prepareSide({
    side: 'A',
    root: env.sideARoot,
    fixtureSource,
    workDir: path.join(workRoot, 'a'),
    corpus,
    turboCacheDir,
  })
  const sideB = yield* prepareSide({
    side: 'B',
    root: env.sideBRoot,
    fixtureSource,
    workDir: path.join(workRoot, 'b'),
    corpus,
    turboCacheDir,
  })

  const result = yield* runBench({
    corpus,
    sideA,
    sideB,
    runsRoot,
    reportPath,
    setupSteps: [...sideA.setupSteps, ...sideB.setupSteps, ...setupSteps],
    baseSha: env.baseSha,
    headSha: env.headSha,
  })

  yield* Effect.forEach(result.runs, (run) => Console.log(runLogLine(run)))
  yield* fs.writeFileString(env.stepSummary, result.markdown, { flag: 'a' })
  yield* Console.log(result.annotationLine)

  if (result.outcome === 'failed') {
    yield* Effect.sync(() => {
      globalThis.process.exitCode = 1
    })
  }
})

NodeRuntime.runMain({ disableErrorReporting: true })(program.pipe(Effect.provide(nodeServicesLayer)))
