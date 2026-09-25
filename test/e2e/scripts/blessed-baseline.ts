#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Array, Boolean, ConfigProvider, Effect, Layer, ManagedRuntime, Match, Option, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import { ChildProcessSpawner } from 'effect/unstable/process'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'
import { RunEvent } from '@systemfsoftware/stryker-js'

import type { BakeOutcome } from '../src/Harness/bake-key.schema.js'
import { BakedFixtureCache } from '../src/Harness/fixture-cache.service.js'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { GuestJobs } from '../src/Harness/guest-job.service.js'
import type { HarnessError } from '../src/Harness/harness-failure.schema.js'
import { layer as harnessTelemetryLayer } from '../src/Harness/harness-telemetry.service.js'
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

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const slices: OracleSliceId[] = []
  let verify = false
  for (const arg of argv) {
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
      Match.tag('mutant', (mutant) => [statusPairOf(mutant.mutator, mutant.status)]),
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

async function runSliceOnce(
  runtime: HarnessRuntime,
  slice: OracleSliceId,
  attempt: number,
): Promise<BlessedBaseline> {
  const config = OracleSliceConfig.SLICES[slice]
  const fixtureName = `oracle-${slice}`
  const warm = await runtime.runPromise(BakedFixtureCache.use((cache) => cache.warm(ENTERPRISE_FIXTURE_URL)))
  const args: string[] = ['run', config.strykerConfig]
  const run: ExecResult = await runtime.runPromise(
    Effect.scoped(StrykerCliRunner.use((runner) => runner.run(args, warm, fixtureName))).pipe(
      Effect.map((forked) => forked.result),
    ),
  )
  if (run.exitCode !== 0) {
    throw new Error(
      `Slice "${slice}" (attempt ${attempt}) exited with code ${run.exitCode}; refusing to bless a failing run.\nstdout: ${
        run.stdout.slice(-2000)
      }\nstderr: ${run.stderr.slice(-2000)}`,
    )
  }
  return parseRunEvents(run.stdout, slice).baseline
}

async function writeBaselineFile(baseline: BlessedBaseline): Promise<string> {
  const outPath = join(BASELINE_OUTPUT_DIR, `${baseline.slice}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  const encoded = Result.getOrThrow(Schema.encodeUnknownResult(BlessedBaseline)(baseline))
  await writeFile(outPath, `${JSON.stringify(encoded, undefined, 2)}\n`, 'utf8')
  return outPath
}

async function readExistingBaseline(slice: OracleSliceId): Promise<BlessedBaseline | undefined> {
  const path = join(BASELINE_OUTPUT_DIR, `${slice}.json`)
  try {
    const text = await readFile(path, 'utf8')
    return Result.getOrThrow(Schema.decodeUnknownResult(BlessedBaseline)(JSON.parse(text)))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw cause
  }
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

async function blessSlice(runtime: HarnessRuntime, slice: OracleSliceId, verify: boolean): Promise<void> {
  const sliceConfig: OracleSliceConfig = OracleSliceConfig.SLICES[slice]
  const existing = await readExistingBaseline(slice)
  const wallStartMs = Date.now()
  const firstStartMs = Date.now()
  const first = await runSliceOnce(runtime, slice, 1)
  const firstFinishedMs = Date.now()
  reportRun(slice, 1, firstStartMs, firstFinishedMs)

  if (verify) {
    const secondStartMs = Date.now()
    const second = await runSliceOnce(runtime, slice, 2)
    const secondFinishedMs = Date.now()
    reportRun(slice, 2, secondStartMs, secondFinishedMs)
    const gateDiff = compareBaselines(foldForGate(first), foldForGate(second))
    if (!gateDiff.isEmpty()) {
      throw new Error(
        `Slice "${slice}" is FLAKY across two consecutive runs on the normalized projection (R5 flake gate).\n${
          formatBaselineDiff(gateDiff)
        }`,
      )
    }
    const rawDiff = compareBaselines(first, second)
    if (!rawDiff.isEmpty()) {
      console.log(
        `[${slice}] flake gate: raw K/T boundary moved but the folded projection agrees:\n${
          formatBaselineDiff(rawDiff)
        }`,
      )
    } else {
      console.log(`[${slice}] flake gate: 2/2 runs agree byte-for-byte`)
    }
  }

  if (existing !== undefined) {
    const drift = compareBaselines(foldForGate(existing), foldForGate(first))
    if (!drift.isEmpty()) {
      console.log(
        `[${slice}] note: existing baseline at ${
          join(BASELINE_OUTPUT_DIR, `${slice}.json`)
        } differs from fresh blessing on the normalized projection:\n${formatBaselineDiff(drift)}`,
      )
    } else {
      console.log(`[${slice}] note: existing baseline matches fresh blessing on the normalized projection`)
    }
  }

  const outPath = await writeBaselineFile(first)
  console.log(
    `[${slice}] blessed baseline written: ${outPath} (slice=${sliceConfig.id}, config=${sliceConfig.strykerConfig})`,
  )
  console.log(`[${slice}] total wall=${(Date.now() - wallStartMs) / 1000}s`)
}

let bakeOutcome: BakeOutcome | undefined

const selfBakingHarness = Layer.mergeAll(
  BakedFixtureCache.layer,
  StrykerCliRunner.layer,
  GuestJobs.layer,
).pipe(
  Layer.provideMerge(
    ConfigProvider.layerAdd(
      Effect.map(
        BakedFixtureCache.bakeProgram,
        (outcome) => {
          bakeOutcome = outcome
          return ConfigProvider.fromUnknown({
            [BakedFixtureCache.BAKED_ROOT_ENV]: outcome.root,
            [BakedFixtureCache.BAKED_KEYS_ENV]: JSON.stringify(outcome.keys),
          })
        },
      ),
      { asPrimary: true },
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(GuestJobs.layer, nodeServicesLayer, Readiness.NodeHostProber.layer, harnessTelemetryLayer),
  ),
)

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.verify && args.slices.length > 1) {
    throw new Error('--verify runs two consecutive runs per slice; pass exactly one slice with --verify')
  }
  const runtime = ManagedRuntime.make(selfBakingHarness)
  try {
    for (const requested of args.slices) {
      const known = ensureKnownSlice(requested)
      await blessSlice(runtime, known, args.verify)
    }
  } finally {
    if (bakeOutcome !== undefined) {
      await runtime.runPromiseExit(BakedFixtureCache.teardownProgram(bakeOutcome))
    }
    await runtime.dispose()
  }
}

main().catch((cause: unknown) => {
  console.error((cause as Error).message)
  process.exit(1)
})
