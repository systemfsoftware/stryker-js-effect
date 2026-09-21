import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'
import { pollWindowSpans } from './__fixtures__/tempo.js'

const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e'
const telemetryEnabled = process.env['OTEL_ENABLED'] === 'true'

const ENTERPRISE_ORACLE = {
  counts: {
    compileErrors: 61,
    ignored: 0,
    killed: 120,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
    survived: 1,
    timeout: 0,
  },
  killed: 120,
  survived: 1,
  total: 182,
  mutatorStatusTally: {
    'ArithmeticOperator:Killed': 9,
    'ArrayDeclaration:Killed': 1,
    'ArrowFunction:CompileError': 13,
    'ArrowFunction:Killed': 1,
    'AssignmentOperator:Killed': 2,
    'BlockStatement:CompileError': 14,
    'BlockStatement:Killed': 12,
    'BooleanLiteral:CompileError': 1,
    'BooleanLiteral:Killed': 11,
    'ConditionalExpression:CompileError': 5,
    'ConditionalExpression:Killed': 38,
    'EqualityOperator:CompileError': 5,
    'EqualityOperator:Killed': 14,
    'EqualityOperator:Survived': 1,
    'LogicalOperator:CompileError': 7,
    'LogicalOperator:Killed': 4,
    'MethodExpression:Killed': 1,
    'ObjectLiteral:CompileError': 10,
    'ObjectLiteral:Killed': 1,
    'OptionalChaining:CompileError': 2,
    'StringLiteral:CompileError': 4,
    'StringLiteral:Killed': 23,
    'UpdateOperator:Killed': 3,
  },
  actionableStatusTally: {
    'EqualityOperator:Survived': 1,
  },
} as const

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutant', 'tick']
const REQUIRED_EVENT_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutant', 'verdict']
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

const tallySumOf = (tally: Readonly<Record<string, number>>): number =>
  Object.values(tally).reduce((sum, n) => sum + n, 0)

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
  expect.soft(kinds).toEqual(expect.arrayContaining([...REQUIRED_EVENT_KINDS]))
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
  expect.soft(tallySumOf(reportedTally)).toBe(ENTERPRISE_ORACLE.total)
  expect
    .soft(tallyOf(Object.keys(ENTERPRISE_ORACLE.actionableStatusTally), actionable))
    .toEqual(ENTERPRISE_ORACLE.actionableStatusTally)
  const countsSum = verdict.counts.killed +
    verdict.counts.survived +
    verdict.counts.compileErrors +
    verdict.counts.runtimeErrors +
    verdict.counts.timeout +
    verdict.counts.noCoverage
  expect.soft(countsSum).toBe(ENTERPRISE_ORACLE.total)
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
    ([key, entry]) => /^node_modules\/@systemfsoftware\/stryker[^/]*$/.test(key) && entry.resolved !== undefined,
  )
  expect.soft(registryEntries.length).toBeGreaterThanOrEqual(1)
  for (const [key, entry] of registryEntries) {
    expect
      .soft(`${key} -> ${entry.resolved}`)
      .toMatch(/\.tgz$/)
    expect.soft(`${key} -> ${entry.resolved}`).not.toMatch(/registry\.npmjs\.org/)
  }
}

const stepVerifyPersistedReport = async (
  expect: ExpectStatic,
  fixture: PreparedFixture,
  verdict: VerdictReached,
): Promise<void> => {
  const reportText = await fixture.readFile('reports/mutation/mutation.json')
  const report = JSON.parse(reportText) as {
    schemaVersion?: string
    files?: Record<string, {
      mutants?: Record<string, {
        id: string
        status: string
        mutatorName: string
        replacement?: string
        killedBy?: readonly string[]
      }>
    }>
  }
  expect.soft(report.schemaVersion).toBe('1.0')
  expect.soft(report.files).toBeDefined()

  const allReportedMutants = Object.values(report.files ?? {}).flatMap((file) => Object.values(file.mutants ?? {}))
  expect.soft(allReportedMutants).toHaveLength(ENTERPRISE_ORACLE.total)

  const killedInReport = allReportedMutants.filter((m) => m.status === 'Killed').length
  const survivedInReport = allReportedMutants.filter((m) => m.status === 'Survived').length
  const compileErrorsInReport = allReportedMutants.filter((m) => m.status === 'CompileError').length

  expect.soft(killedInReport).toBe(verdict.counts.killed)
  expect.soft(survivedInReport).toBe(verdict.counts.survived)
  expect.soft(compileErrorsInReport).toBe(verdict.counts.compileErrors)

  const killedMutants = allReportedMutants.filter((m) => m.status === 'Killed')
  expect.soft(killedMutants.length).toBe(verdict.counts.killed)
  expect.soft(killedMutants.every((m) => (m.killedBy?.length ?? 0) > 0)).toBe(true)

  const booleanKilled = killedMutants.filter((m) => m.mutatorName === 'BooleanLiteral')
  expect.soft(booleanKilled.length).toBeGreaterThan(0)
  expect.soft(booleanKilled.every((m) => (m.killedBy?.length ?? 0) > 0)).toBe(true)

  const survivedMutant = allReportedMutants.find((m) => m.status === 'Survived')
  expect.soft(survivedMutant).toBeDefined()
  expect.soft(survivedMutant?.mutatorName).toBe('EqualityOperator')
  expect.soft(survivedMutant?.killedBy ?? []).toEqual([])
}

test(
  'running the enterprise monorepo fixture through the packed runner',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>
    let verdict: VerdictReached
    let startedSeconds: number

    await bdd.given('a packaged enterprise workspace in the container', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-monorepo-fixture')
    })

    await bdd.when('the CLI executes the full monorepo mutation run', async () => {
      startedSeconds = Math.floor(Date.now() / 1000) - 5
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

    await bdd.and('the structured mutation report is persisted to disk and matches the verdict', async () => {
      await stepVerifyPersistedReport(expect, fixture, verdict)
    })

    if (telemetryEnabled) {
      await bdd.and('the distributed trace spans propagate across checker and worker boundaries', async () => {
        const spans = await pollWindowSpans({
          startSeconds: startedSeconds,
          serviceName: SERVICE_NAME,
          isSettled: (seen) => seen.length > 0,
        })
        expect.soft(spans.length).toBeGreaterThan(0)
      })
    }
  },
)

test(
  'sabotage verification: failing the break threshold on survived mutants causes non-zero process exit',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>

    await bdd.given('a packaged enterprise workspace in the container', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-monorepo-sabotage-fixture')
    })

    await bdd.when('the CLI executes with an active break threshold on an imperfect suite', async () => {
      run = await fixture.run(['run', 'stryker.sabotage.config.ts'])
      events = parseEventStream(run.stdout)
    })

    await bdd.thenAssert('the CLI detects the surviving mutant, breaches the threshold, and exits non-zero', () => {
      const terminal = lastEvent(events)
      expect.soft(run.exitCode).toBe(1)
      expect.soft(terminal._tag).toBe('verdict')
      expect.soft(terminal._tag === 'verdict' ? terminal.counts.survived : -1).toBeGreaterThan(0)
      expect.soft(terminal._tag === 'verdict' ? terminal.thresholds.break : null).toBe(100)
    })
  },
)
