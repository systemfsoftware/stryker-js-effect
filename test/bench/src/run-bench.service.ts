import {
  BENCH_ORDER,
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
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Crypto from 'effect/Crypto'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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
  readonly setupSteps: ReadonlyArray<SetupStep>
  readonly baseSha: string
  readonly headSha: string
  readonly runTimeoutMs: number
  readonly deadlineMs: number
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

const slug = (value: string): string => value.replace(/[^A-Za-z0-9._-]+/g, '-')

const STDERR_TAIL_CHARS = 4096

const tailOf = (text: string): string => text.slice(-STDERR_TAIL_CHARS)

interface CliExit {
  readonly exit: RunExit
  readonly stderrTail: string
}

const runCli = (
  params: Pick<PreparedSide, 'cli' | 'cwd' | 'configFile'> & {
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

interface RunOutcome {
  readonly run: BenchRun
  readonly exit: RunExit
  readonly wallMs: number
}

const runOne = (
  input: RunBenchInput,
  prepared: PreparedSide,
  pristine: PristineTree,
  position: number,
  timeoutMs: number,
): Effect.Effect<RunOutcome, BenchOrchestrationFailed, BenchPlatform> =>
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
      timeoutMs,
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
    const run = Result.merge(
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
    return { run, exit: cliExit.exit, wallMs }
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

const budgetExceeded = (what: string, earlierWallMs: ReadonlyArray<number>): BenchOrchestrationFailed =>
  BenchOrchestrationFailed.make({
    code: 'budget-exceeded',
    reason: `${what}; setup and the ${earlierWallMs.length} finished runs used the budget (runs: ${
      earlierWallMs.map((ms) => `${(ms / 1000).toFixed(1)}s`).join(', ')
    })`,
  })

const runAt = (
  input: RunBenchInput,
  targets: { readonly A: PreparedTarget; readonly B: PreparedTarget },
  earlier: Ref.Ref<ReadonlyArray<number>>,
) =>
(side: BenchSide, position: number): Effect.Effect<BenchRun, BenchOrchestrationFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const label = `run ${position + 1} of ${BENCH_ORDER.length} (side ${side})`
    const remainingMs = input.deadlineMs - (yield* Clock.currentTimeMillis)
    yield* Boolean.match(remainingMs <= 0, {
      onTrue: () =>
        Effect.flatMap(
          Ref.get(earlier),
          (wallMs) => Effect.fail(budgetExceeded(`the job deadline passed before ${label}`, wallMs)),
        ),
      onFalse: () => Effect.void,
    })
    const timeoutMs = Math.min(input.runTimeoutMs, remainingMs)
    const target = targets[side]
    const outcome = yield* runOne(input, target.prepared, target.pristine, position, timeoutMs)
    yield* Match.valueTags(outcome.exit, {
      exited: () => Effect.void,
      'timed-out': () =>
        Boolean.match(timeoutMs < input.runTimeoutMs, {
          onTrue: () =>
            Effect.flatMap(
              Ref.get(earlier),
              (wallMs) =>
                Effect.fail(budgetExceeded(`the job deadline stopped ${label} after ${timeoutMs} ms`, wallMs)),
            ),
          onFalse: () => Effect.void,
        }),
    })
    yield* Ref.update(earlier, (wallMs) => [...wallMs, outcome.wallMs])
    return outcome.run
  })

export const runBench = (
  input: RunBenchInput,
): Effect.Effect<RunBenchResult, BenchOrchestrationFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const earlier = yield* Ref.make<ReadonlyArray<number>>([])
    const targets = { A: yield* prepareTarget(input.sideA), B: yield* prepareTarget(input.sideB) }
    const runs = yield* Effect.forEach(BENCH_ORDER, runAt(input, targets, earlier))

    const summary = summarizeBench(SummarizeBenchCommand.make({ runs: [...runs] }))
    const outcome = Result.match(summary, {
      onFailure: (failure) => ({ _tag: 'failed' as const, invalid: Arr.filter(failure.runs, S.is(BenchRunInvalid)) }),
      onSuccess: (decision) => ({ _tag: 'summarized' as const, projects: decision.projects }),
    })
    const report = BenchReport.make({
      schemaVersion: '1.1',
      baseSha: input.baseSha,
      headSha: input.headSha,
      outcome,
      runs: Arr.map(
        Arr.filter(runs, S.is(BenchRunMeasured)),
        (run) => ({
          key: run.key,
          wallMs: run.wallMs,
          exitCode: run.exitCode,
          testsExecuted: run.testsExecuted,
          workloadDigest: run.workloadDigest,
        }),
      ),
      setupSteps: [...input.setupSteps],
    })

    return { report, runs }
  })
