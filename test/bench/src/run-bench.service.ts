import {
  BENCH_ORDER,
  type BenchCorpus,
  type BenchCorpusName,
  BenchReport,
  type BenchRun,
  BenchRunInvalid,
  BenchRunKey,
  BenchRunMeasured,
  type BenchSide,
  readBenchRun,
  ReadBenchRunCommand,
  type RunExit,
  type SetupStep,
  summarizeBench,
  SummarizeBenchCommand,
} from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Crypto from 'effect/Crypto'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import type { PreparedSide } from './prepared-side.js'
import { workloadDigest } from './workload-digest.service.js'

export interface RunBenchInput {
  readonly corpus: BenchCorpus
  readonly sideA: PreparedSide
  readonly sideB: PreparedSide
  readonly runsRoot: string
  readonly setupSteps: ReadonlyArray<SetupStep>
  readonly baseSha: string
  readonly headSha: string
  readonly runTimeoutMs: number
}

export interface RunBenchResult {
  readonly report: BenchReport
  readonly runs: ReadonlyArray<BenchRun>
}

type BenchPlatform =
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto

interface RunParams {
  readonly corpus: BenchCorpusName
  readonly entry: string
  readonly side: BenchSide
  readonly position: number
  readonly cwd: string
  readonly configFile: string
  readonly cli: string
  readonly sideRoot: string
}

const slug = (value: string): string => value.replace(/[^A-Za-z0-9._-]+/g, '-')

const STDERR_TAIL_CHARS = 4096

const tailOf = (text: string): string => text.slice(-STDERR_TAIL_CHARS)

interface CliExit {
  readonly exit: RunExit
  readonly stderrTail: string
}

const runCli = (
  params: Pick<RunParams, 'cli' | 'cwd' | 'configFile'> & {
    readonly streamFile: string
    readonly incrementalFile: string
    readonly timeoutMs: number
  },
): Effect.Effect<CliExit, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const stderr = yield* Ref.make('')
    const exited = yield* Effect.scoped(Effect.gen(function*() {
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
    })).pipe(Effect.timeoutOption(Duration.millis(params.timeoutMs)), Effect.orDie)
    const exit = Option.match(exited, {
      onNone: (): RunExit => ({ _tag: 'timed-out', afterMs: params.timeoutMs }),
      onSome: (code): RunExit => ({ _tag: 'exited', code }),
    })
    return { exit, stderrTail: yield* Ref.get(stderr) }
  })

const streamLines = (
  fs: FileSystem.FileSystem,
  file: string,
): Effect.Effect<ReadonlyArray<string>> =>
  fs.readFileString(file).pipe(
    Effect.map((text) => text.split('\n')),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  )

const runOne = (input: RunBenchInput, params: RunParams): Effect.Effect<BenchRun, never, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const stem = `${params.corpus}-${params.side}-${params.position}-${slug(params.entry)}`
    const streamFile = path.join(input.runsRoot, `${stem}.jsonl`)
    const incrementalFile = path.join(input.runsRoot, `${stem}.json`)

    const startedAt = yield* Clock.currentTimeMillis
    const cliExit = yield* runCli({
      cli: params.cli,
      cwd: params.cwd,
      configFile: params.configFile,
      streamFile,
      incrementalFile,
      timeoutMs: input.runTimeoutMs,
    })
    const wallMs = (yield* Clock.currentTimeMillis) - startedAt

    const lines = yield* streamLines(fs, streamFile)
    const digest = yield* workloadDigest({
      kind: params.corpus,
      cwd: params.cwd,
      sideRoot: params.sideRoot,
      incrementalFile,
    })
    const key = BenchRunKey.make({
      corpus: params.corpus,
      entry: params.entry,
      side: params.side,
      position: params.position,
    })
    return Result.merge(
      readBenchRun(
        ReadBenchRunCommand.make({
          key,
          lines,
          exit: cliExit.exit,
          workloadDigest: digest,
          stderrTail: cliExit.stderrTail,
          wallMs,
        }),
      ),
    )
  })

const sideOf = (input: RunBenchInput, side: BenchSide): PreparedSide => (side === 'A' ? input.sideA : input.sideB)

const runSide = (
  input: RunBenchInput,
  side: BenchSide,
  position: number,
): Effect.Effect<ReadonlyArray<BenchRun>, never, BenchPlatform> =>
  Effect.gen(function*() {
    const prepared = sideOf(input, side)
    const repoRuns = yield* Effect.forEach(prepared.repoEntries, (repoEntry) =>
      runOne(input, {
        corpus: 'repo',
        entry: repoEntry.entry.project,
        side,
        position,
        cwd: repoEntry.cwd,
        configFile: repoEntry.configFile,
        cli: prepared.cli,
        sideRoot: prepared.root,
      }))
    const enterprise = yield* runOne(input, {
      corpus: 'enterprise',
      entry: input.corpus.enterprise.fixture,
      side,
      position,
      cwd: prepared.enterprise.cwd,
      configFile: prepared.enterprise.configFile,
      cli: prepared.enterprise.cli,
      sideRoot: prepared.root,
    })
    return [...repoRuns, enterprise]
  })

export const runBench = (input: RunBenchInput): Effect.Effect<RunBenchResult, never, BenchPlatform> =>
  Effect.gen(function*() {
    const runs = yield* Effect.forEach(
      BENCH_ORDER,
      (side, position) => runSide(input, side, position),
    ).pipe(Effect.map((byPosition) => Arr.flatten(byPosition)))

    const summary = summarizeBench(SummarizeBenchCommand.make({ runs: [...runs] }))
    const outcome = Result.match(summary, {
      onFailure: (failure) => ({ _tag: 'failed' as const, invalid: Arr.filter(failure.runs, S.is(BenchRunInvalid)) }),
      onSuccess: (decision) => ({ _tag: 'summarized' as const, projects: decision.projects }),
    })
    const report = BenchReport.make({
      schemaVersion: '1.0',
      baseSha: input.baseSha,
      headSha: input.headSha,
      outcome,
      runs: Arr.map(
        Arr.filter(runs, S.is(BenchRunMeasured)),
        (run) => ({ key: run.key, wallMs: run.wallMs, exitCode: run.exitCode }),
      ),
      setupSteps: [...input.setupSteps],
    })

    return { report, runs }
  })
