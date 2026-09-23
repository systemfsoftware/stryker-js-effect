#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ManagedRuntime } from 'effect'

import { type RunEvent, RunEventWireLine, S } from '@systemfsoftware/stryker-js'

import {
  type BakedFixtureCacheService,
  type ExecResult,
  type HarnessError,
  installFixture,
  runCli,
  SelfBakingHarnessLive,
  type StrykerCliRunnerService,
} from '../tests/__fixtures__/microvm-environment.js'
import {
  ARTIFACT_CONTRACT,
  type BaselineCountKey,
  type BaselineCounts,
  type BlessedBaseline,
  compareBaselines,
  decodeBaseline,
  encodeBaseline,
  formatBaselineDiff,
  type OracleSliceId,
  sortTally,
  tallyMutatorStatuses,
  ZERO_COUNTS,
} from './oracle/baseline.js'
import { foldTimeoutIntoKilled, normalizeTally } from './oracle/normalize.js'
import { ORACLE_SLICES, type OracleSliceConfig } from './oracle/slice-config.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const BASELINE_OUTPUT_DIR = join(REPO_ROOT, 'test/e2e/oracle-baselines')

type HarnessRuntime = ManagedRuntime.ManagedRuntime<BakedFixtureCacheService | StrykerCliRunnerService, HarnessError>

const foldForGate = (baseline: BlessedBaseline): BlessedBaseline => ({
  ...baseline,
  counts: foldTimeoutIntoKilled(baseline.counts),
  mutatorStatusTally: normalizeTally(baseline.mutatorStatusTally),
})
const SABOTAGE_SLICE = 'sabotage'
const SABOTAGE_REASON =
  'R9: sabotage is never blessable — threshold-breach assertions stay hand-authored outside regeneration scope (R12)'

const REGISTERED_IDS: ReadonlyArray<OracleSliceId> = Object.freeze(
  Object.keys(ORACLE_SLICES) as OracleSliceId[],
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
  if (!(id in ORACLE_SLICES)) {
    throw new Error(
      `Unknown slice "${id}". Valid slices: ${listValidSliceIds()}. ${SABOTAGE_SLICE} is rejected because ${SABOTAGE_REASON}`,
    )
  }
  return id as OracleSliceId
}

const COUNTS_KEY_MAP: Readonly<Record<keyof BaselineCounts, BaselineCountKey>> = Object.freeze({
  compileErrors: 'compileErrors',
  ignored: 'ignored',
  killed: 'killed',
  noCoverage: 'noCoverage',
  pending: 'pending',
  runtimeErrors: 'runtimeErrors',
  survived: 'survived',
  timeout: 'timeout',
})

type MutantEvent = Extract<RunEvent, { _tag: 'mutant' }>
type VerdictEvent = Extract<RunEvent, { _tag: 'verdict' }>

function decodeWireLine(line: string, _slice: OracleSliceId): RunEvent {
  return S.decodeUnknownSync(RunEventWireLine)(line)
}

interface ParsedRun {
  readonly baseline: BlessedBaseline
}

function parseRunEvents(stdout: string, slice: OracleSliceId): ParsedRun {
  const events: RunEvent[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || !line.startsWith('{') || !line.endsWith('}')) {
      continue
    }
    let event: RunEvent
    try {
      event = decodeWireLine(line, slice)
    } catch (cause) {
      throw new Error(
        `Slice "${slice}" produced a malformed RunEvent line; refusing to bless garbage: ${(cause as Error).message}`,
        { cause },
      )
    }
    events.push(event)
  }
  if (events.length === 0) {
    throw new Error(`Slice "${slice}" produced no RunEvents on stdout; refusing to bless an empty stream.`)
  }
  const terminal = events.at(-1) as RunEvent
  if (terminal._tag !== 'verdict') {
    throw new Error(
      `Slice "${slice}" terminated with event _tag "${terminal._tag}", expected "verdict". Refusing to bless garbage.`,
    )
  }
  const verdict = terminal as VerdictEvent
  const counts = verdict.counts as unknown as Readonly<Record<keyof BaselineCounts, unknown>>
  const validatedCounts = { ...ZERO_COUNTS } as Record<BaselineCountKey, number>
  for (const key of Object.keys(ZERO_COUNTS) as ReadonlyArray<keyof BaselineCounts>) {
    const value = counts[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(
        `Slice "${slice}" verdict.counts.${key} was ${
          JSON.stringify(value)
        }; expected non-negative integer. Refusing to bless garbage.`,
      )
    }
    validatedCounts[COUNTS_KEY_MAP[key]] = value
  }
  const mutatorStatusPairs: Array<[string, string]> = []
  for (const event of events) {
    if (event._tag !== 'mutant') {
      continue
    }
    const mutantEvent = event as MutantEvent
    const mutator = mutantEvent.mutator
    const status = mutantEvent.status
    if (typeof mutator !== 'string' || typeof status !== 'string') {
      throw new Error(
        `Slice "${slice}" emitted a "mutant" event with non-string mutator/status: mutator=${
          JSON.stringify(mutator)
        }, status=${JSON.stringify(status)}. Refusing to bless garbage.`,
      )
    }
    mutatorStatusPairs.push([mutator, status])
  }
  const config = ORACLE_SLICES[slice]
  return {
    baseline: {
      artifactContract: ARTIFACT_CONTRACT,
      slice,
      strykerConfig: config.strykerConfig,
      counts: validatedCounts as BaselineCounts,
      mutatorStatusTally: sortTally(tallyMutatorStatuses(mutatorStatusPairs)),
    },
  }
}

async function runSliceOnce(
  runtime: HarnessRuntime,
  slice: OracleSliceId,
  attempt: number,
): Promise<BlessedBaseline> {
  const config = ORACLE_SLICES[slice]
  const fixtureName = `oracle-${slice}`
  const installedPath = await runtime.runPromise(
    installFixture({ url: ENTERPRISE_FIXTURE_URL, name: fixtureName }),
  )
  const args: string[] = ['run', config.strykerConfig]
  const run: ExecResult = await runtime.runPromise(runCli(args, installedPath))
  if (run.exitCode !== 0) {
    throw new Error(
      `Slice "${slice}" (attempt ${attempt}) exited with code ${run.exitCode}; refusing to bless a failing run.\nstdout: ${
        run.stdout.slice(-2000)
      }\nstderr: ${run.stderr.slice(-2000)}`,
    )
  }
  const parsed = parseRunEvents(run.stdout, slice)
  return parsed.baseline
}

async function writeBaselineFile(baseline: BlessedBaseline): Promise<string> {
  const outPath = join(BASELINE_OUTPUT_DIR, `${baseline.slice}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, encodeBaseline(baseline), 'utf8')
  return outPath
}

async function readExistingBaseline(slice: OracleSliceId): Promise<BlessedBaseline | undefined> {
  const path = join(BASELINE_OUTPUT_DIR, `${slice}.json`)
  try {
    const text = await readFile(path, 'utf8')
    return decodeBaseline(text)
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

async function blessSlice(runtime: HarnessRuntime, slice: OracleSliceId, verify: boolean): Promise<void> {
  const sliceConfig: OracleSliceConfig = ORACLE_SLICES[slice]
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.verify && args.slices.length > 1) {
    throw new Error('--verify runs two consecutive runs per slice; pass exactly one slice with --verify')
  }
  const runtime = ManagedRuntime.make(SelfBakingHarnessLive)
  try {
    for (const requested of args.slices) {
      const known = ensureKnownSlice(requested)
      await blessSlice(runtime, known, args.verify)
    }
  } finally {
    await runtime.dispose()
  }
}

main().catch((cause: unknown) => {
  console.error((cause as Error).message)
  process.exit(1)
})
