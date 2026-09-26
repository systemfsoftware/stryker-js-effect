#!/usr/bin/env tsx
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Array, Boolean, ConfigProvider, Effect, Layer, Match, Option, Result, Schema } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { RunEvent } from '@systemfsoftware/stryker-js'

import type { BakeOutcome } from '../src/Harness/bake-key.schema.js'
import { BakedFixtureCache } from '../src/Harness/fixture-cache.service.js'
import { BlessRefused } from '../src/Harness/harness-failure.schema.js'
import { HarnessPlatformLive, HarnessServicesLive } from '../src/Harness/harness-layers.js'
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

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const slices: OracleSliceId[] = []
  let verify = false
  for (const arg of argv) {
    if (arg === '--') {
      continue
    }
    if (arg === '--verify') {
      verify = true
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`)
    }
    slices.push(ensureKnownSlice(arg))
  }
  if (slices.length === 0) {
    throw new Error(`No slices provided. Valid slices: ${listValidSliceIds()}`)
  }
  return { slices, verify }
}

function ensureKnownSlice(id: string): OracleSliceId {
  if (id === SABOTAGE_SLICE) {
    throw new Error(`Slice "${SABOTAGE_SLICE}" cannot be blessed. ${SABOTAGE_REASON}`)
  }
  return Option.match(Schema.decodeUnknownOption(OracleSliceIds)(id), {
    onNone: () => {
      throw new Error(
        `Unknown slice "${id}". Valid slices: ${listValidSliceIds()}. ${SABOTAGE_SLICE} is rejected because ${SABOTAGE_REASON}`,
      )
    },
    onSome: (sliceId) => sliceId,
  })
}

type VerdictEvent = Extract<RunEvent.RunEvent, { _tag: 'verdict' }>

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
    Object.keys(tally).sort().flatMap((key): ReadonlyArray<readonly [string, number]> =>
      sortEntryOf(key, tally[key] ?? 0)
    ),
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

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const refuse = (reason: string): Effect.Effect<never, BlessRefused> => Effect.fail(new BlessRefused({ reason }))

const decodeEvent = (line: string, slice: OracleSliceId): RunEvent.RunEvent =>
  Result.match(Schema.decodeResult(RunEvent.RunEventWireLine)(line), {
    onFailure: (issue) => {
      throw new Error(
        `Slice "${slice}" produced a malformed RunEvent line; refusing to bless garbage: ${issue.message}`,
        { cause: issue },
      )
    },
    onSuccess: (event) => event,
  })

interface ParsedRun {
  readonly baseline: BlessedBaseline
}

const statusPairOf = (mutator: string, status: string): readonly [string, string] => [mutator, status]

const mutatorStatusPairsOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<readonly [string, string]> =>
  events.flatMap((event) =>
    Match.value(event).pipe(
      Match.tag('mutantTested', (mutant) => [statusPairOf(mutant.mutatorName, mutant.status)]),
      Match.orElse(() => []),
    )
  )

function parseRunEvents(stdout: string, slice: OracleSliceId): ParsedRun {
  const events = stdout.split('\n').flatMap((rawLine) => {
    const line = rawLine.trim()
    return Boolean.match(line.length > 0 && line.startsWith('{') && line.endsWith('}'), {
      onFalse: () => [],
      onTrue: () => [decodeEvent(line, slice)],
    })
  })
  const mutatorStatusPairs = mutatorStatusPairsOf(events)
  return Option.match(Option.fromNullishOr(events.at(-1)), {
    onNone: () => {
      throw new Error(`Slice "${slice}" produced no RunEvents on stdout; refusing to bless an empty stream.`)
    },
    onSome: (terminal) =>
      Match.value(terminal).pipe(
        Match.tag('verdict', (verdict) => ({
          baseline: BlessedBaseline.make({
            artifactContract: BlessedBaseline.ARTIFACT_CONTRACT,
            slice,
            strykerConfig: OracleSliceConfig.SLICES[slice].strykerConfig,
            counts: countsOf(verdict),
            mutatorStatusTally: sortTally(tallyMutatorStatuses(mutatorStatusPairs)),
          }),
        })),
        Match.orElse((terminal) => {
          throw new Error(
            `Slice "${slice}" terminated with event _tag "${terminal._tag}", expected "verdict". Refusing to bless garbage.`,
          )
        }),
      ),
  })
}

const runSliceOnce = (slice: OracleSliceId, attempt: number) =>
  Effect.gen(function*() {
    const config = OracleSliceConfig.SLICES[slice]
    const fixtureName = `oracle-${slice}`
    const cache = yield* BakedFixtureCache
    const warm = yield* cache.warm(ENTERPRISE_FIXTURE_URL)
    const runner = yield* StrykerCliRunner
    const forked = yield* Effect.scoped(runner.run(['run', config.strykerConfig], warm, fixtureName))
    const run = forked.result
    if (run.exitCode !== 0) {
      return yield* refuse(
        `Slice "${slice}" (attempt ${attempt}) exited with code ${run.exitCode}; refusing to bless a failing run.\nstdout: ${
          run.stdout.slice(-2000)
        }\nstderr: ${run.stderr.slice(-2000)}`,
      )
    }
    return yield* Effect.try({
      try: () => parseRunEvents(run.stdout, slice).baseline,
      catch: (cause) => new BlessRefused({ reason: messageOf(cause) }),
    })
  })

const writeBaselineFile = (baseline: BlessedBaseline) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const outPath = path.join(BASELINE_OUTPUT_DIR, `${baseline.slice}.json`)
    yield* fs.makeDirectory(BASELINE_OUTPUT_DIR, { recursive: true })
    const encoded = yield* Effect.try({
      try: () => Result.getOrThrow(Schema.encodeUnknownResult(BlessedBaseline)(baseline)),
      catch: (cause) => new BlessRefused({ reason: messageOf(cause) }),
    })
    yield* fs.writeFileString(outPath, `${JSON.stringify(encoded, undefined, 2)}\n`)
    return outPath
  })

const readExistingBaseline = (slice: OracleSliceId) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const filePath = path.join(BASELINE_OUTPUT_DIR, `${slice}.json`)
    const present = yield* fs.exists(filePath)
    if (!present) {
      return undefined
    }
    const text = yield* fs.readFileString(filePath)
    return yield* Effect.try({
      try: () => Result.getOrThrow(Schema.decodeUnknownResult(BlessedBaseline)(JSON.parse(text))),
      catch: (cause) => new BlessRefused({ reason: messageOf(cause) }),
    })
  })

const reportRun = (slice: OracleSliceId, attempt: number, startedMs: number, finishedMs: number): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(`[${slice}] run ${attempt}: wall=${(finishedMs - startedMs) / 1000}s`)
  })

interface BaselineDiff {
  readonly countsDiff: Readonly<Record<string, readonly [number, number]>>
  readonly tallyDiff: Readonly<Record<string, readonly [number, number]>>
  isEmpty(): boolean
}

const driftPairOf = (first: number, second: number): readonly [number, number] => [first, second]

const countDiffOf = (a: BlessedBaseline, b: BlessedBaseline): Record<string, readonly [number, number]> =>
  BASELINE_COUNT_KEYS.reduce<Record<string, readonly [number, number]>>(
    (diff, key) =>
      Boolean.match(a.counts[key] === b.counts[key], {
        onTrue: () => diff,
        onFalse: () => ({ ...diff, [key]: driftPairOf(a.counts[key], b.counts[key]) }),
      }),
    {},
  )

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
    onFalse: () =>
      [
        'baseline diff:',
        ...diffSectionLines('counts', diff.countsDiff),
        ...diffSectionLines('mutatorStatusTally', diff.tallyDiff),
      ].join('\n'),
  })

const blessSlice = (slice: OracleSliceId, verify: boolean) =>
  Effect.gen(function*() {
    const sliceConfig: OracleSliceConfig = OracleSliceConfig.SLICES[slice]
    const existing = yield* readExistingBaseline(slice)
    const wallStartMs = Date.now()
    const firstStartMs = Date.now()
    const first = yield* runSliceOnce(slice, 1)
    const firstFinishedMs = Date.now()
    yield* reportRun(slice, 1, firstStartMs, firstFinishedMs)

    if (verify) {
      const secondStartMs = Date.now()
      const second = yield* runSliceOnce(slice, 2)
      const secondFinishedMs = Date.now()
      yield* reportRun(slice, 2, secondStartMs, secondFinishedMs)
      const gateDiff = compareBaselines(foldForGate(first), foldForGate(second))
      if (!gateDiff.isEmpty()) {
        return yield* refuse(
          `Slice "${slice}" is FLAKY across two consecutive runs on the normalized projection (R5 flake gate).\n${
            formatBaselineDiff(gateDiff)
          }`,
        )
      }
      const rawDiff = compareBaselines(first, second)
      if (!rawDiff.isEmpty()) {
        yield* Effect.sync(() =>
          console.log(
            `[${slice}] flake gate: raw K/T boundary moved but the folded projection agrees:\n${
              formatBaselineDiff(rawDiff)
            }`,
          )
        )
      } else {
        yield* Effect.sync(() => console.log(`[${slice}] flake gate: 2/2 runs agree byte-for-byte`))
      }
    }

    if (existing !== undefined) {
      const drift = compareBaselines(foldForGate(existing), foldForGate(first))
      if (!drift.isEmpty()) {
        yield* Effect.sync(() =>
          console.log(
            `[${slice}] note: existing baseline at ${
              join(BASELINE_OUTPUT_DIR, `${slice}.json`)
            } differs from fresh blessing on the normalized projection:\n${formatBaselineDiff(drift)}`,
          )
        )
      } else {
        yield* Effect.sync(() =>
          console.log(`[${slice}] note: existing baseline matches fresh blessing on the normalized projection`)
        )
      }
    }

    const outPath = yield* writeBaselineFile(first)
    yield* Effect.sync(() => {
      console.log(
        `[${slice}] blessed baseline written: ${outPath} (slice=${sliceConfig.id}, config=${sliceConfig.strykerConfig})`,
      )
      console.log(`[${slice}] total wall=${(Date.now() - wallStartMs) / 1000}s`)
    })
  })

const bakedConfigLayer = ConfigProvider.layerAdd(
  Effect.acquireRelease(
    BakedFixtureCache.bakeProgram,
    (outcome: BakeOutcome) => BakedFixtureCache.teardownProgram(outcome).pipe(Effect.ignore),
  ).pipe(
    Effect.map((outcome) =>
      ConfigProvider.fromUnknown({
        [BakedFixtureCache.BAKED_ROOT_ENV]: outcome.root,
        [BakedFixtureCache.BAKED_KEYS_ENV]: JSON.stringify(outcome.keys),
      })
    ),
  ),
  { asPrimary: true },
)

const harnessLayer = HarnessServicesLive.pipe(
  Layer.provideMerge(bakedConfigLayer),
  Layer.provideMerge(HarnessPlatformLive),
)

const program = Effect.gen(function*() {
  const args = yield* Effect.try({
    try: () => parseArgs(process.argv.slice(2)),
    catch: (cause) => new BlessRefused({ reason: messageOf(cause) }),
  })
  if (args.verify && args.slices.length > 1) {
    return yield* refuse('--verify runs two consecutive runs per slice; pass exactly one slice with --verify')
  }
  yield* Effect.forEach(args.slices, (slice) => blessSlice(slice, args.verify), { discard: true }).pipe(
    Effect.provide(harnessLayer),
  )
})

NodeRuntime.runMain(program)
