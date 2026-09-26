import { RunEvent } from '@systemfsoftware/stryker-js'
import { it } from '@systemfsoftware/vitest'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'

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
const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutantTested',
  'tick',
  'plugins',
  'formats',
  'skipped',
]
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[`)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent.RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEvent.RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
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

const reportedMutants = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutantTested' }> => event._tag === 'mutantTested')
    .map((mutant) => `${mutant.mutatorName}:${mutant.status}`)

const runIdsIn = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .map((event) => ('runId' in event && typeof event.runId === 'string' ? String(event.runId) : undefined))
    .filter((runId): runId is string => runId !== undefined)

const countedSumOf = (counts: RunEvent.VerdictReached['counts']): number =>
  counts.killed + counts.survived + counts.timeout + counts.compileErrors +
  counts.ignored + counts.noCoverage + counts.pending + counts.runtimeErrors

const verifyStreamAndExit = (expect: Expect, run: ExecResult, events: ReadonlyArray<RunEvent.RunEvent>): Check => {
  const kinds = events.map((event) => event._tag)
  const preceding = kinds.slice(0, -1)

  return expect({
    exitCode: run.exitCode,
    terminalIndexes: terminalIndexesIn(kinds),
    lastKind: kinds.at(-1),
    ansiMatch: run.stdout.match(ANSI_ESCAPE),
    precedingIsNonEmpty: preceding.length > 0,
    strayPrecedingKinds: preceding.filter((kind) => !NON_TERMINAL_RUN_KINDS.includes(kind)),
    workerSockMatch: `${run.stdout}\n${run.stderr}`.match(/Could not restrict "[^"]*worker\.sock"/),
  }).toStrictEqual({
    exitCode: 0,
    terminalIndexes: [kinds.length - 1],
    lastKind: 'verdict',
    ansiMatch: null,
    precedingIsNonEmpty: true,
    strayPrecedingKinds: [],
    workerSockMatch: null,
  })
}

const verifyOracleCounts = (expect: Expect, verdict: RunEvent.VerdictReached): Check =>
  expect({
    break: verdict.thresholds.break,
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
  }).toStrictEqual({
    break: null,
    compileErrors: 0,
    ignored: 0,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
  })

const verifyReportedAndActionableMutants = (
  expect: Expect,
  events: ReadonlyArray<RunEvent.RunEvent>,
  verdict: RunEvent.VerdictReached,
): Check =>
  expect({
    reportedCount: reportedMutants(events).length,
    talliedCount: countedSumOf(verdict.counts),
  }).toStrictEqual({
    reportedCount: CALC_FIXTURE_ORACLE.total,
    talliedCount: CALC_FIXTURE_ORACLE.total,
  })

const verifyRunIdConsistency = (
  expect: Expect,
  events: ReadonlyArray<RunEvent.RunEvent>,
  verdict: RunEvent.VerdictReached,
): Check => {
  const runIds = runIdsIn(events)

  return expect({
    carriesAtLeastTwoRunIds: runIds.length >= 2,
    distinctRunIds: new Set(runIds).size,
    verdictRunIdMatchesFirst: verdict.runId === runIds.at(0),
  }).toStrictEqual({
    carriesAtLeastTwoRunIds: true,
    distinctRunIds: 1,
    verdictRunIdMatchesFirst: true,
  })
}

it.live('running one mutation run through the packed runner', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'a packaged Stryker fixture in the container',
    prepareFixture(CALC_FIXTURE_URL, 'calc-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'the CLI is executed in machine mode with default configuration',
    Effect.promise(() => fixture.run(['run', '--json'])),
  )
  const events = parseEventStream(run.stdout)
  const terminal = lastEvent(events)
  if (terminal._tag !== 'verdict') {
    throw new Error(
      `Expected terminal verdict event, received: ${terminal._tag} ${
        JSON.stringify(terminal).slice(0, 4000)
      }\nstderr tail: ${run.stderr.slice(-3000)}`,
    )
  }

  yield* bddStep('Then', 'the process protocol and stream invariants hold', verifyStreamAndExit(expect, run, events))
  yield* bddStep('And', 'the mutation verdict tallies match the calc oracle', verifyOracleCounts(expect, terminal))
  yield* bddStep(
    'And',
    'every reported mutant is counted in the verdict',
    verifyReportedAndActionableMutants(expect, events, terminal),
  )
  yield* bddStep('And', 'every event carries the verdict run id', verifyRunIdConsistency(expect, events, terminal))
})
