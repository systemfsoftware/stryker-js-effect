#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Array, Boolean, ConfigProvider, Effect, Layer, ManagedRuntime, Match, Option, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import { ChildProcessSpawner } from 'effect/unstable/process'

import { type RunEvent, RunEventWireLine } from '@systemfsoftware/stryker-js'
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'

import { BakedFixtureCache } from '../src/Harness/fixture-cache.service.js'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { GuestJobs } from '../src/Harness/guest-job.service.js'
import type { HarnessError } from '../src/Harness/harness-failure.schema.js'
import { BlessRefused } from '../src/Harness/harness-failure.schema.js'
import { StrykerCliRunner } from '../src/Harness/stryker-cli-runner.service.js'
import {
  type BaselineCounts,
  BlessedBaseline,
  type OracleSliceId,
  OracleSliceId as OracleSliceIds,
} from '../src/Oracle/baseline.schema.js'
import { OracleSliceConfig } from '../src/Oracle/slice-config.schema.js'
import { foldTimeoutIntoKilled, normalizeTally } from './oracle/normalize.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const BASELINE_OUTPUT_DIR = join(REPO_ROOT, 'test/e2e/oracle-baselines')

type HarnessRuntime = ManagedRuntime.ManagedRuntime<
  | BakedFixtureCache
  | StrykerCliRunner
  | GuestJobs
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | Readiness.HostProber,
  HarnessError
>

const foldForGate = (baseline: BlessedBaseline): BlessedBaseline => ({
  ...baseline,
  counts: foldTimeoutIntoKilled(baseline.counts),
  mutatorStatusTally: normalizeTally(baseline.mutatorStatusTally),
})

const SABOTAGE_SLICE = 'sabotage'
const SABOTAGE_REASON =
  'R9: sabotage is never blessable — threshold-breach assertions stay hand-authored outside regeneration scope (R12)'

const REGISTERED_IDS: ReadonlyArray<OracleSliceId> = Object.freeze(
  Object.values(OracleSliceConfig.SLICES).map((slice) => slice.id),
)

function listValidSliceIds(): string {
  return REGISTERED_IDS.join(', ')
}

interface ParsedArgs {
  readonly slices: ReadonlyArray<OracleSliceId>
  readonly verify: boolean
}

interface PartialArgs {
  readonly slices: ReadonlyArray<OracleSliceId>
  readonly verify: boolean
}

const partialArgsOf = (arg: string, parsed: PartialArgs): Result.Result<PartialArgs, BlessRefused> =>
  Boolean.match(arg === '--verify', {
    onTrue: () => Result.succeed({ ...parsed, verify: true }),
    onFalse: () =>
      Boolean.match(arg.startsWith('--'), {
        onTrue: () => Result.fail(BlessRefused.make({ reason: `Unknown flag: ${arg}` })),
        onFalse: () =>
          Result.map(knownSliceOf(arg), (slice) => ({ ...parsed, slices: [...parsed.slices, slice] })),
      }),
  })
const argsOf = (argv: ReadonlyArray<string>): Result.Result<ParsedArgs, BlessRefused> =>
  Result.flatMap(
    Array.reduce(argv, Result.succeed({ slices: [], verify: false }), (accumulated, arg) =>
      Result.flatMap(accumulated, (parsed) => partialArgsOf(arg, parsed))),
    (parsed) =>
      Match.value(parsed.slices.length === 0).pipe(
        Match.when(true, () =>
          Result.fail(
            BlessRefused.make({
              reason: `No slices provided. Valid slices: ${listValidSliceIds()}`,
            }),
          )),
        Match.when(false, () => Result.succeed({ slices: parsed.slices, verify: parsed.verify })),
        Match.exhaustive,
      ),
  )

const knownSliceOf = (id: string): Result.Result<OracleSliceId, BlessRefused> =>
  Match.value(id).pipe(
    Match.when(SABOTAGE_SLICE, () =>
      Result.fail(
        BlessRefused.make({ reason: `Slice "${SABOTAGE_SLICE}" cannot be blessed. ${SABOTAGE_REASON}` }),
      )),
    Match.orElse((candidate) =>
      Option.match(Schema.decodeUnknownOption(OracleSliceIds)(candidate), {
        onNone: () =>
          Result.fail(
            BlessRefused.make({
              reason:
                `Unknown slice "${candidate}". Valid slices: ${listValidSliceIds()}. ${SABOTAGE_SLICE} is rejected because ${SABOTAGE_REASON}`,
            }),
          ),
        onSome: (sliceId) => Result.succeed(sliceId),
      })
    ),
  )

type VerdictEvent = Extract<RunEvent, { _tag: 'verdict' }>

const BASELINE_COUNT_KEYS = [
  'compileErrors',
  'ignored',
  'killed',
  'noCoverage',
  'pending',
  'runtimeErrors',
  'survived',
  'timeout',
] as const

const tallyMutatorStatuses = (pairs: ReadonlyArray<readonly [string, string]>): Readonly<Record<string, number>> =>
  pairs.reduce<Record<string, number>>((tally, [mutator, status]) => {
    const key = `${mutator}:${status}`
    return { ...tally, [key]: (tally[key] ?? 0) + 1 }
  }, {})

const sortEntryOf = (key: string, count: number): ReadonlyArray<readonly [string, number]> =>
  Boolean.match(count > 0, {
    onTrue: () => [[key, count]],
    onFalse: () => [],
  })

const sortTally = (tally: Readonly<Record<string, number>>): Readonly<Record<string, number>> =>
  Object.fromEntries(
    Object.keys(tally).sort().flatMap((key): ReadonlyArray<readonly [string, number]> => sortEntryOf(key, tally[key] ?? 0)),
  )

const countsOf = (verdict: VerdictEvent): BaselineCounts => ({
  compileErrors: verdict.counts.compileErrors,
  ignored: verdict.counts.ignored,
  killed: verdict.counts.killed,
  noCoverage: verdict.counts.noCoverage,
  pending: verdict.counts.pending,
  runtimeErrors: verdict.counts.runtimeErrors,
  survived: verdict.counts.survived,
  timeout: verdict.counts.timeout,
})

const decodeEvent = (line: string, slice: OracleSliceId): Result.Result<RunEvent, BlessRefused> =>
  Result.mapError(
    Schema.decodeResult(RunEventWireLine)(line),
    (issue) =>
      BlessRefused.make({
        reason: `Slice "${slice}" produced a malformed RunEvent line; refusing to bless garbage: ${issue.message}`,
      }),
  )

interface ParsedRun {
  readonly baseline: BlessedBaseline
}

const parseEventLines = (
  stdout: string,
  slice: OracleSliceId,
): Result.Result<ReadonlyArray<RunEvent>, BlessRefused> =>
  Result.all(
    stdout.split('\n').flatMap((rawLine) => {
      const line = rawLine.trim()
      return passedRunEventLine(line) ? [decodeEvent(line, slice)] : []
    }),
  )

const passedRunEventLine = (line: string): boolean =>
  line.length > 0 && line.startsWith('{') && line.endsWith('}')

const baselineOfTerminal = (
  terminal: RunEvent,
  slice: OracleSliceId,
  pairs: ReadonlyArray<readonly [string, string]>,
): Result.Result<BlessedBaseline, BlessRefused> =>
  Match.value(terminal._tag).pipe(
    Match.when('verdict', () =>
      Result.succeed(
        BlessedBaseline.make({
          artifactContract: BlessedBaseline.ARTIFACT_CONTRACT,
          slice,
          strykerConfig: OracleSliceConfig.SLICES[slice].strykerConfig,
          counts: countsOf(terminal as VerdictEvent),
          mutatorStatusTally: sortTally(tallyMutatorStatuses(pairs)),
        }),
      )),
    Match.orElse((tag) =>
      Result.fail(
        BlessRefused.make({
          reason: `Slice "${slice}" terminated with event _tag "${tag}", expected "verdict". Refusing to bless garbage.`,
        }),
      )),
  )

const parseRunEvents = (stdout: string, slice: OracleSliceId): Result.Result<ParsedRun, BlessRefused> =>
  Result.flatMap(parseEventLines(stdout, slice), (events) =>
    Boolean.match(events.length === 0, {
      onTrue: () =>
        Result.fail(
          BlessRefused.make({
            reason: `Slice "${slice}" produced no RunEvents on stdout; refusing to bless an empty stream.`,
          }),
        ),
      onFalse: () => {
        const terminal = events.at(-1)
        return terminal === undefined
          ? Result.fail(
            BlessRefused.make({
              reason: `Slice "${slice}" produced no RunEvents on stdout; refusing to bless an empty stream.`,
            }),
          )
          : Result.map(baselineOfTerminal(terminal, slice, mutatorStatusPairsOf(events)), (baseline) => ({ baseline }))
      },
    }))

const runOutcomeOf = (
  outcome: ExecResult,
  slice: OracleSliceId,
  attempt: number,
): Result.Result<ExecResult, BlessRefused> =>
  Boolean.match(outcome.exitCode === 0, {
    onTrue: () => Result.succeed(outcome),
    onFalse: () =>
      Result.fail(
        BlessRefused.make({
          reason:
            `Slice "${slice}" (attempt ${attempt}) exited with code ${outcome.exitCode}; refusing to bless a failing run.\nstdout: ${
              outcome.stdout.slice(-2000)
            }\nstderr: ${outcome.stderr.slice(-2000)}`,
        }),
      ),
  })
const runSliceOnce = (
  runtime: HarnessRuntime,
  slice: OracleSliceId,
  attempt: number,
): Effect.Effect<BlessedBaseline, HarnessError> => {
  const config = OracleSliceConfig.SLICES[slice]
  const fixtureName = `oracle-${slice}`
  const args: string[] = ['run', config.strykerConfig]
  return Effect.gen(function*() {
    const installedPath = yield* Effect.promise(() =>
      runtime.runPromise(
        BakedFixtureCache.use((cache) => cache.install({ url: ENTERPRISE_FIXTURE_URL, name: fixtureName })),
      ))
    const outcome = yield* Effect.promise(() =>
      runtime.runPromise(StrykerCliRunner.use((runner) => runner.run(args, installedPath))))
    const parsed = yield* runOutcomeOf(outcome, slice, attempt)
    return (yield* parseRunEvents(parsed.stdout, slice)).baseline
  })
}

const writeBaselineFile = (baseline: BlessedBaseline): Effect.Effect<string, BlessRefused> => {
  const outPath = join(BASELINE_OUTPUT_DIR, `${baseline.slice}.json`)
  return Effect.flatMap(
    Effect.fromResult(Schema.encodeSyncResult(BlessedBaseline)(baseline)),
    (encoded) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            mkdir(dirname(outPath), { recursive: true }).then(() =>
              writeFile(outPath, `${JSON.stringify(encoded, undefined, 2)}\n`, 'utf8')),
          catch: () => BlessRefused.make({ reason: `Cannot write baseline file ${outPath}` }),
        }),
        {
          onFailure: (refused) => Effect.fail(refused),
          onSuccess: () => Effect.succeed(outPath),
        },
      ),
  )
}

const readExistingBaseline = (slice: OracleSliceId): Effect.Effect<BlessedBaseline | undefined, BlessRefused> => {
  const path = join(BASELINE_OUTPUT_DIR, `${slice}.json`)
  return Effect.matchEffect(
    Effect.tryPromise({
      try: () => readFile(path, 'utf8'),
      catch: () => BlessRefused.make({ reason: `Cannot read existing baseline for slice "${slice}"` }),
    }),
    {
      onFailure: (refused) =>
        Boolean.match(refused.reason.startsWith('Cannot read existing baseline') && refused.reason.includes('ENOENT'), {
          onTrue: () => Effect.succeed(undefined),
          onFalse: () => Effect.fail(refused),
        }),
      onSuccess: (text) =>
        Effect.matchEffect(
          Effect.fromResult(Schema.decodeUnknownResult(BlessedBaseline)(JSON.parse(text))),
          {
            onFailure: (issue) =>
              Effect.fail(
                BlessRefused.make({
                  reason:
                    `Existing baseline for slice "${slice}" is malformed; refusing to bless onto garbage: ${issue.message}`,
                }),
              ),
            onSuccess: (baseline) => Effect.succeed(baseline),
          },
        ),
    },
  )
}

function reportRun(slice: OracleSliceId, attempt: number, startedMs: number, finishedMs: number): void {
  console.log(`[${slice}] run ${attempt}: wall=${(finishedMs - startedMs) / 1000}s`)
}

interface BaselineDiff {
  readonly countsDiff: Readonly<Record<string, readonly [number, number]>>
  readonly tallyDiff: Readonly<Record<string, readonly [number, number]>>
  isEmpty(): boolean
}

const driftPairOf = (first: number, second: number): readonly [number, number] => [first, second]

const countDiffOf = (a: BlessedBaseline, b: BlessedBaseline): Record<string, readonly [number, number]> =>
  BASELINE_COUNT_KEYS.reduce<Record<string, readonly [number, number]>>((diff, key) =>
    Boolean.match(a.counts[key] === b.counts[key], {
      onTrue: () => diff,
      onFalse: () => ({ ...diff, [key]: driftPairOf(a.counts[key], b.counts[key]) }),
    }), {})

const tallyDiffOf = (a: BlessedBaseline, b: BlessedBaseline): Record<string, readonly [number, number]> =>
  Array.dedupe([...Object.keys(a.mutatorStatusTally), ...Object.keys(b.mutatorStatusTally)])
    .reduce<Record<string, readonly [number, number]>>((diff, key) => {
      const av = a.mutatorStatusTally[key] ?? 0
      const bv = b.mutatorStatusTally[key] ?? 0
      return Boolean.match(av === bv, {
        onTrue: () => diff,
        onFalse: () => ({ ...diff, [key]: driftPairOf(av, bv) }),
      })
    }, {})

const compareBaselines = (a: BlessedBaseline, b: BlessedBaseline): BaselineDiff => {
  const countsDiff = countDiffOf(a, b)
  const tallyDiff = tallyDiffOf(a, b)
  return {
    countsDiff,
    tallyDiff,
    isEmpty: () => Object.keys(countsDiff).length === 0 && Object.keys(tallyDiff).length === 0,
  }
}

const diffSectionLines = (
  label: string,
  section: Readonly<Record<string, readonly [number, number]>>,
): readonly string[] =>
  Boolean.match(Object.keys(section).length === 0, {
    onTrue: () => [],
    onFalse: () => [
      `  ${label}:`,
      ...Object.entries(section)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, [av, bv]]) => `    ${key}: ${av} -> ${bv}`),
    ],
  })

const formatBaselineDiff = (diff: BaselineDiff): string =>
  Boolean.match(diff.isEmpty(), {
    onTrue: () => 'baseline diff: <empty>',
    onFalse: () => [
      'baseline diff:',
      ...diffSectionLines('counts', diff.countsDiff),
      ...diffSectionLines('mutatorStatusTally', diff.tallyDiff),
    ].join('\n'),
  })

const blessSlice = (
  runtime: HarnessRuntime,
  slice: OracleSliceId,
  verify: boolean,
): Effect.Effect<void, HarnessError> => {
  const sliceConfig: OracleSliceConfig = OracleSliceConfig.SLICES[slice]
  return Effect.gen(function*() {
    const existing = yield* readExistingBaseline(slice)
    const wallStartMs = Date.now()
    const firstStartMs = Date.now()
    const first = yield* runSliceOnce(runtime, slice, 1)
    const firstFinishedMs = Date.now()
    yield* reportRunEffect(slice, 1, firstStartMs, firstFinishedMs)

    if (verify) {
      const secondStartMs = Date.now()
      const second = yield* runSliceOnce(runtime, slice, 2)
      const secondFinishedMs = Date.now()
      yield* reportRunEffect(slice, 2, secondStartMs, secondFinishedMs)
      const gateDiff = compareBaselines(foldForGate(first), foldForGate(second))
      if (!gateDiff.isEmpty()) {
        return yield* Effect.fail(
          BlessRefused.make({
            reason:
              `Slice "${slice}" is FLAKY across two consecutive runs on the normalized projection (R5 flake gate).\n${
                formatBaselineDiff(gateDiff)
              }`,
          }),
        )
      }
      const rawDiff = compareBaselines(first, second)
      if (!rawDiff.isEmpty()) {
        yield* Effect.sync(() =>
          process.stdout.write(
            `[${slice}] flake gate: raw K/T boundary moved but the folded projection agrees:\n${
              formatBaselineDiff(rawDiff)
            }\n`,
          ))
      } else {
        yield* Effect.sync(() => process.stdout.write(`[${slice}] flake gate: 2/2 runs agree byte-for-byte\n`))
      }
    }

    if (existing !== undefined) {
      const drift = compareBaselines(foldForGate(existing), foldForGate(first))
      if (!drift.isEmpty()) {
        yield* Effect.sync(() =>
          process.stdout.write(
            `[${slice}] note: existing baseline at ${
              join(BASELINE_OUTPUT_DIR, `${slice}.json`)
            } differs from fresh blessing on the normalized projection:\n${formatBaselineDiff(drift)}\n`,
          ))
      } else {
        yield* Effect.sync(() =>
          process.stdout.write(`[${slice}] note: existing baseline matches fresh blessing on the normalized projection\n`))
      }
    }

    const outPath = yield* writeBaselineFile(first)
    yield* Effect.sync(() =>
      process.stdout.write(
        `[${slice}] blessed baseline written: ${outPath} (slice=${sliceConfig.id}, config=${sliceConfig.strykerConfig})\n`,
      ))
    yield* Effect.sync(() => process.stdout.write(`[${slice}] total wall=${(Date.now() - wallStartMs) / 1000}s\n`))
  })
}

const reportRunEffect = (
  slice: OracleSliceId,
  attempt: number,
  startedMs: number,
  finishedMs: number,
): Effect.Effect<void> => Effect.sync(() => reportRun(slice, attempt, startedMs, finishedMs))

const selfBakingHarness = Layer.mergeAll(
  BakedFixtureCache.layer,
  StrykerCliRunner.layer,
  GuestJobs.layer,
).pipe(
  Layer.provideMerge(
    ConfigProvider.layerAdd(
      Effect.map(BakedFixtureCache.bakeProgram, (root) =>
        ConfigProvider.fromUnknown({ [BakedFixtureCache.BAKED_ROOT_ENV]: root })),
      { asPrimary: true },
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(GuestJobs.layer, nodeServicesLayer, Readiness.NodeHostProber.layer)),
)

const blessProgram = (argv: ReadonlyArray<string>): Effect.Effect<void, HarnessError, HarnessRuntime> =>
  Effect.flatMap(Effect.fromResult(argsOf(argv)), (args) =>
    Boolean.match(args.verify && args.slices.length > 1, {
      onTrue: () =>
        Effect.fail(
          BlessRefused.make({
            reason: '--verify runs two consecutive runs per slice; pass exactly one slice with --verify',
          }),
        ),
      onFalse: () =>
        Effect.forEach(args.slices, (requested) =>
          Effect.flatMap(
            Effect.fromResult(knownSliceOf(requested)),
            (known) => blessSliceEffect(known, args.verify),
          ), { discard: true }),
    }))

const blessSliceEffect = (
  slice: OracleSliceId,
  verify: boolean,
): Effect.Effect<void, HarnessError, HarnessRuntime> =>
  Effect.flatMap(Effect.runtime<HarnessRuntime>(), (runtime) => blessSlice(runtime, slice, verify))

const harnessMessageOf = (cause: unknown): string =>
  Match.value(cause).pipe(
    Match.when(Schema.is(BlessRefused), (refused) => refused.message),
    Match.orElse(() => 'bless failed: refusing to bless onto an unrecognized failure'),
  )

const edge = ManagedRuntime.make(selfBakingHarness)

edge.runPromise(blessProgram(process.argv.slice(2))).then(
  () => edge.dispose().then(() => process.exit(0)),
  (cause: HarnessError) => {
    process.stderr.write(`${harnessMessageOf(cause)}\n`)
    return edge.dispose().then(() => process.exit(1))
  },
)
