import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

const ENTERPRISE_ORACLE = {
  killed: 176,
  survived: 2,
  total: 182,
  counts: {
    compileErrors: 4,
    ignored: 0,
    killed: 176,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
    survived: 2,
    timeout: 0,
  },
  mutatorStatusTally: {
    'ArithmeticOperator:Killed': 9,
    'ArrayDeclaration:Killed': 1,
    'ArrowFunction:Killed': 14,
    'AssignmentOperator:Killed': 2,
    'BlockStatement:Killed': 26,
    'BooleanLiteral:Killed': 12,
    'ConditionalExpression:Killed': 43,
    'EqualityOperator:Killed': 18,
    'EqualityOperator:Survived': 2,
    'LogicalOperator:Killed': 11,
    'MethodExpression:Killed': 1,
    'ObjectLiteral:CompileError': 1,
    'ObjectLiteral:Killed': 10,
    'OptionalChaining:Killed': 2,
    'StringLiteral:CompileError': 3,
    'StringLiteral:Killed': 24,
    'UpdateOperator:Killed': 3,
  },
} as const

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutant', 'tick']
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[`)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent>): RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const tallyOf = (
  keys: ReadonlyArray<string>,
  statuses: ReadonlyArray<string>,
): Readonly<Record<string, number>> =>
  keys.reduce<Record<string, number>>(
    (tally, key) => ({ ...tally, [key]: statuses.filter((status) => status === key).length }),
    {},
  )

const stepVerifyStreamAndExit = (
  expect: ExpectStatic,
  run: ExecResult,
  events: ReadonlyArray<RunEvent>,
): void => {
  const kinds = events.map((e) => e._tag)
  const preceding = kinds.slice(0, -1)

  expect.soft(run.exitCode).toBe(0)
  expect.soft(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
  expect.soft(kinds.at(-1)).toBe('verdict')
  expect.soft(run.stdout).not.toMatch(ANSI_ESCAPE)
  expect.soft(preceding.length).toBeGreaterThan(0)
  expect.soft(preceding.filter((k) => !NON_TERMINAL_RUN_KINDS.includes(k))).toEqual([])
  expect.soft(`${run.stdout}\n${run.stderr}`).not.toMatch(/Could not restrict "[^"]*worker\.sock"/)
  expect.soft(`${run.stdout}\n${run.stderr}`).not.toMatch(/[Uu]nhandled (promise )?rejection/)
}

const stepVerifyOracleCounts = (expect: ExpectStatic, verdict: VerdictReached): void => {
  expect.soft(verdict.thresholds.break).toBeNull()
  expect.soft({
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    killed: verdict.counts.killed,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
    survived: verdict.counts.survived,
    timeout: verdict.counts.timeout,
  }).toEqual(ENTERPRISE_ORACLE.counts)
}

const stepVerifyMutatorTallies = (
  expect: ExpectStatic,
  events: ReadonlyArray<RunEvent>,
  verdict: VerdictReached,
): void => {
  const reported = events
    .filter((event): event is Extract<RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
    .map((m) => `${m.mutator}:${m.status}`)
  const actionable = verdict.mutants.map((m) => `${m.mutator}:${m.status}`)

  expect.soft(reported).toHaveLength(ENTERPRISE_ORACLE.total)
  const reportedTally = tallyOf(Object.keys(ENTERPRISE_ORACLE.mutatorStatusTally), reported)
  expect.soft(reportedTally).toEqual(ENTERPRISE_ORACLE.mutatorStatusTally)
  expect.soft(tallyOf(Object.keys(ENTERPRISE_ORACLE.mutatorStatusTally), actionable)).toEqual(reportedTally)
  const tallySum = Object.values(reportedTally).reduce((sum, n) => sum + n, 0)
  expect.soft(tallySum).toBe(ENTERPRISE_ORACLE.total)
  expect.soft(verdict.counts.killed + verdict.counts.survived + verdict.counts.compileErrors).toBe(
    ENTERPRISE_ORACLE.total,
  )
}

const stepVerifyRunIdConsistency = (
  expect: ExpectStatic,
  events: ReadonlyArray<RunEvent>,
  verdict: VerdictReached,
): void => {
  const runIds = events
    .map((event) => ('runId' in event && typeof event.runId === 'string' ? event.runId : undefined))
    .filter((runId): runId is string => runId !== undefined)

  expect.soft(runIds.length).toBeGreaterThanOrEqual(2)
  expect.soft(new Set(runIds).size).toBe(1)
  expect.soft(verdict.runId).toBe(runIds.at(0))
}

const stepVerifyTarballProvenance = async (expect: ExpectStatic, fixture: PreparedFixture): Promise<void> => {
  const lockfile = JSON.parse(await fixture.readFile('package-lock.json')) as {
    packages?: Record<string, { resolved?: string | undefined }>
  }
  const registryEntries = Object.entries(lockfile.packages ?? {}).filter(
    ([key, entry]) => key.startsWith('node_modules/@systemfsoftware/') && entry.resolved !== undefined,
  )
  expect.soft(registryEntries.length).toBeGreaterThanOrEqual(1)
  for (const [key, entry] of registryEntries) {
    expect
      .soft(`${key} -> ${entry.resolved}`)
      .toMatch(/\.tgz$/)
    expect.soft(`${key} -> ${entry.resolved}`).not.toMatch(/registry\.npmjs\.org/)
  }
}

test(
  'running the enterprise monorepo fixture through the packed runner',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>
    let verdict: VerdictReached

    await bdd.given('a packaged enterprise workspace in the container', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-monorepo-fixture')
    })

    await bdd.when('the CLI executes the full monorepo mutation run', async () => {
      run = await fixture.run(['run'])
      events = parseEventStream(run.stdout)
      const terminal = lastEvent(events)
      if (terminal._tag !== 'verdict') {
        throw new Error(`Expected terminal verdict event, received: ${terminal._tag}`)
      }
      verdict = terminal
    })

    await bdd.thenAssert('the process protocol and stream invariants hold', () => {
      stepVerifyStreamAndExit(expect, run, events)
    })

    await bdd.and('the mutation verdict tallies match the enterprise oracle', () => {
      stepVerifyOracleCounts(expect, verdict)
      stepVerifyMutatorTallies(expect, events, verdict)
      stepVerifyRunIdConsistency(expect, events, verdict)
    })

    await bdd.and('every workspace tool resolved from the packed tarballs', async () => {
      await stepVerifyTarballProvenance(expect, fixture)
    })
  },
)
