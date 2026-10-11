import {
  BENCH_ORDER,
  type BenchCorpusName,
  type BenchReportOutcome,
  type BenchReportRun,
  type BenchRun,
  BenchRunInvalid,
  BenchRunKey,
  BenchRunMeasured,
  type BenchSide,
  readBenchRun,
  ReadBenchRunCommand,
  summarizeBench,
  SummarizeBenchCommand,
} from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Crypto from 'effect/Crypto'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { BenchOrchestrationFailed } from './bench-failure.schema.js'
import type { PreparedSide } from './prepared-side.js'
import { type PristineTree, restoreTree, snapshotTree } from './pristine-tree.service.js'
import { workloadDigest } from './workload-digest.service.js'

export interface RunBenchInput {
  readonly corpus: BenchCorpusName
  readonly entry: string
  readonly sideA: PreparedSide
  readonly sideB: PreparedSide
  readonly runsRoot: string
  readonly sha: string
  readonly parentSha: string
}

export interface RunBenchResult {
  readonly outcome: BenchReportOutcome
  readonly reportRuns: ReadonlyArray<BenchReportRun>
  readonly runs: ReadonlyArray<BenchRun>
}

type BenchPlatform =
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto

const slug = (value: string): string => value.replace(/[^A-Za-z0-9._-]+/g, '-')

const STDERR_TAIL_CHARS = 4096

const tailOf = (text: string): string => text.slice(-STDERR_TAIL_CHARS)

interface CliExit {
  readonly exitCode: number
  readonly stderrTail: string
}

const runCli = (
  params: Pick<PreparedSide, 'cli' | 'cwd' | 'configFile'> & {
    readonly streamFile: string
    readonly incrementalFile: string
  },
): Effect.Effect<CliExit, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const stderr = yield* Ref.make('')
    const exitCode = yield* Effect.scoped(Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          globalThis.process.execPath,
          [
            params.cli,
            'run',
            params.configFile,
            '--full',
            '--progressStreamFile',
            params.streamFile,
            '--incrementalFile',
            params.incrementalFile,
          ],
          { cwd: params.cwd, forceKillAfter: Duration.seconds(10) },
        ),
      )
      const [exitCode] = yield* Effect.all(
        [
          handle.exitCode,
          Stream.runDrain(handle.stdout),
          Stream.runForEach(
            handle.stderr.pipe(Stream.decodeText()),
            (chunk) => Ref.update(stderr, (tail) => tailOf(tail + chunk)),
          ),
        ] as const,
        { concurrency: 'unbounded' },
      )
      return exitCode
    })).pipe(Effect.orDie)
    return { exitCode, stderrTail: yield* Ref.get(stderr) }
  })

const streamLines = (
  fs: FileSystem.FileSystem,
  file: string,
): Effect.Effect<ReadonlyArray<string>> =>
  fs.readFileString(file).pipe(
    Effect.map((text) => text.split('\n')),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  )

const runOne = (
  input: RunBenchInput,
  prepared: PreparedSide,
  pristine: PristineTree,
  position: number,
): Effect.Effect<BenchRun, BenchOrchestrationFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const stem = `${input.corpus}-${prepared.side}-${position}-${slug(input.entry)}`
    const streamFile = path.join(input.runsRoot, `${stem}.jsonl`)
    const incrementalFile = path.join(input.runsRoot, `${stem}.json`)

    yield* restoreTree(pristine).pipe(
      Effect.mapError((cause) =>
        BenchOrchestrationFailed.make({
          code: 'side-setup-failed',
          reason:
            `side ${prepared.side}: ${pristine.root} could not be restored to its prepared state: ${cause.message}`,
        })
      ),
    )
    const startedAt = yield* Clock.currentTimeMillis
    const cliExit = yield* runCli({
      cli: prepared.cli,
      cwd: prepared.cwd,
      configFile: prepared.configFile,
      streamFile,
      incrementalFile,
    })
    const wallMs = (yield* Clock.currentTimeMillis) - startedAt

    const lines = yield* streamLines(fs, streamFile)
    const digest = yield* workloadDigest({
      kind: input.corpus,
      cwd: prepared.cwd,
      sideRoot: prepared.root,
      incrementalFile,
    })
    const key = BenchRunKey.make({ corpus: input.corpus, entry: input.entry, side: prepared.side, position })
    return Result.merge(
      readBenchRun(
        ReadBenchRunCommand.make({
          key,
          lines,
          exitCode: cliExit.exitCode,
          workloadDigest: digest,
          stderrTail: cliExit.stderrTail,
          wallMs,
        }),
      ),
    )
  })

interface PreparedTarget {
  readonly prepared: PreparedSide
  readonly pristine: PristineTree
}

const prepareTarget = (
  prepared: PreparedSide,
): Effect.Effect<PreparedTarget, BenchOrchestrationFailed, BenchPlatform> =>
  Effect.map(
    snapshotTree(prepared.cwd).pipe(
      Effect.mapError((cause) =>
        BenchOrchestrationFailed.make({
          code: 'side-setup-failed',
          reason: `side ${prepared.side}: ${prepared.cwd} could not be read after setup: ${cause.message}`,
        })
      ),
    ),
    (pristine) => ({ prepared, pristine }),
  )

const runAt = (
  input: RunBenchInput,
  targets: { readonly A: PreparedTarget; readonly B: PreparedTarget },
) =>
(side: BenchSide, position: number): Effect.Effect<BenchRun, BenchOrchestrationFailed, BenchPlatform> =>
  runOne(input, targets[side].prepared, targets[side].pristine, position)

const reportRunOf = (run: BenchRunMeasured): BenchReportRun => ({
  key: run.key,
  wallMs: run.wallMs,
  exitCode: run.exitCode,
  testsExecuted: run.testsExecuted,
  workloadDigest: run.workloadDigest,
})

export const runBench = (
  input: RunBenchInput,
): Effect.Effect<RunBenchResult, BenchOrchestrationFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const targets = { A: yield* prepareTarget(input.sideA), B: yield* prepareTarget(input.sideB) }
    const runs = yield* Effect.forEach(BENCH_ORDER, runAt(input, targets))

    const summary = summarizeBench(
      SummarizeBenchCommand.make({ sha: input.sha, parentSha: input.parentSha, runs: [...runs] }),
    )
    const outcome = Result.match(summary, {
      onFailure: (failure): BenchReportOutcome => ({
        _tag: 'failed',
        invalid: Arr.filter(failure.runs, S.is(BenchRunInvalid)),
      }),
      onSuccess: (decision): BenchReportOutcome => ({
        _tag: 'summarized',
        projects: decision.projects,
        regression: decision.regression,
      }),
    })
    return { outcome, reportRuns: Arr.map(Arr.filter(runs, S.is(BenchRunMeasured)), reportRunOf), runs }
  })
