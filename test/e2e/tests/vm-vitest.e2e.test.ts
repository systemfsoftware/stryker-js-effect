import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

const VM_VITEST_ORACLE = {
  killed: 7,
  survived: 2,
  mutantStatusTally: {
    'ArithmeticOperator:Killed': 1,
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Killed': 2,
    'BlockStatement:Survived': 1,
    'ConditionalExpression:Killed': 2,
    'EqualityOperator:Killed': 2,
  },
} as const

const VM_FIXTURE_URL = new URL('../testResources/vm-vitest-fixture', import.meta.url)

const parseEventStream = async (stdout: string): Promise<ReadonlyArray<RunEvent>> =>
  Promise.all(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .map((line) => S.decodeUnknownPromise(RunEventWireLine)(line)),
  )

const lastEvent = (events: ReadonlyArray<RunEvent>): RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const tallyOf = (
  keys: ReadonlyArray<string>,
  statuses: ReadonlyArray<string>,
): Readonly<Record<string, number>> =>
  keys.reduce<Record<string, number>>(
    (tally, key) => ({ ...tally, [key]: statuses.filter((status) => status === key).length }),
    {},
  )

const stepVerifyCounts = (expect: ExpectStatic, verdict: VerdictReached): void => {
  expect.soft({
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    killed: verdict.counts.killed,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
    survived: verdict.counts.survived,
    timeout: verdict.counts.timeout,
  }).toEqual({
    compileErrors: 0,
    ignored: 0,
    killed: VM_VITEST_ORACLE.killed,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
    survived: VM_VITEST_ORACLE.survived,
    timeout: 0,
  })
}

const stepVerifyMutantTally = (expect: ExpectStatic, events: ReadonlyArray<RunEvent>): void => {
  const reported = events
    .filter((event): event is Extract<RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
    .map((m) => `${m.mutator}:${m.status}`)
  expect.soft(reported).toHaveLength(9)
  expect.soft(tallyOf(Object.keys(VM_VITEST_ORACLE.mutantStatusTally), reported)).toEqual(
    VM_VITEST_ORACLE.mutantStatusTally,
  )
}

test('running a vitest-syntax suite through the in-memory runner', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent>
  let verdict: VerdictReached

  await bdd.given('a fixture whose suite is written against vitest and verified in memory', async () => {
    fixture = await prepareFixture(VM_FIXTURE_URL, 'vm-vitest-fixture')
  })

  await bdd.when('the CLI is executed with the in-memory runner', async () => {
    run = await fixture.run(['run'])
    events = await parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected terminal verdict event, received: ${terminal._tag}`)
    }
    verdict = terminal
  })

  await bdd.thenAssert('the run reaches a verdict with every mutant classified', () => {
    expect.soft(run.exitCode).toBe(0)
  })

  await bdd.and('the tallies match the vitest-runner oracle', () => {
    stepVerifyCounts(expect, verdict)
    stepVerifyMutantTally(expect, events)
  })
})
