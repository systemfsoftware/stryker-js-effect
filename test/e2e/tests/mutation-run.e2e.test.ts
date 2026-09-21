import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

const CALC_FIXTURE_ORACLE = {
  killed: 7,
  survived: 2,
  total: 9,
  mutantStatusTally: {
    'ArithmeticOperator:Killed': 1,
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Killed': 2,
    'BlockStatement:Survived': 1,
    'ConditionalExpression:Killed': 2,
    'EqualityOperator:Killed': 2,
  },
  actionableStatusTally: {
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Survived': 1,
  },
} as const

const CALC_FIXTURE_URL = new URL('../testResources/calc-fixture', import.meta.url)
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
}

const stepVerifyOracleCounts = (expect: ExpectStatic, verdict: VerdictReached): void => {
  expect.soft(verdict.thresholds.break).toBeNull()
  expect.soft({
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
  }).toEqual({
    compileErrors: 0,
    ignored: 0,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
  })
}

const stepVerifyReportedAndActionableMutants = (
  expect: ExpectStatic,
  events: ReadonlyArray<RunEvent>,
  verdict: VerdictReached,
): void => {
  const reported = events
    .filter((event): event is Extract<RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
    .map((m) => `${m.mutator}:${m.status}`)

  expect.soft(reported).toHaveLength(CALC_FIXTURE_ORACLE.total)
  expect.soft(
    verdict.counts.killed + verdict.counts.survived + verdict.counts.timeout +
      verdict.counts.compileErrors + verdict.counts.ignored + verdict.counts.noCoverage +
      verdict.counts.pending + verdict.counts.runtimeErrors,
  ).toBe(CALC_FIXTURE_ORACLE.total)
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

test('running one mutation run through the packed runner', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent>
  let verdict: VerdictReached

  await bdd.given('a packaged Stryker fixture in the container', async () => {
    fixture = await prepareFixture(CALC_FIXTURE_URL, 'calc-fixture')
  })

  await bdd.when('the CLI is executed with default configuration', async () => {
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

  await bdd.and('the mutation verdict tallies match the calc oracle', () => {
    stepVerifyOracleCounts(expect, verdict)
    stepVerifyReportedAndActionableMutants(expect, events, verdict)
    stepVerifyRunIdConsistency(expect, events, verdict)
  })
})
