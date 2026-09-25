import { RunEvent } from '@systemfsoftware/stryker-js'
import { it } from '@systemfsoftware/vitest'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'

const VM_VITEST_ORACLE = {
  killed: 7,
  survived: 4,
  noCoverage: 0,
  mutantStatusTally: {
    'ArithmeticOperator:Killed': 1,
    'ArithmeticOperator:Survived': 2,
    'BlockStatement:Killed': 2,
    'BlockStatement:Survived': 2,
    'ConditionalExpression:Killed': 2,
    'EqualityOperator:Killed': 2,
  },
} as const

const VM_FIXTURE_URL = new URL('../testResources/vm-vitest-fixture', import.meta.url)

const parseEventStream = async (stdout: string): Promise<ReadonlyArray<RunEvent.RunEvent>> =>
  Promise.all(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .map((line) => S.decodeUnknownPromise(RunEvent.RunEventWireLine)(line)),
  )

const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
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

interface ReportMutant {
  readonly mutatorName: string
  readonly status: string
  readonly killedBy?: ReadonlyArray<string>
  readonly location?: { readonly start?: { readonly line?: number } }
}

interface MutationReport {
  readonly files: Record<string, { readonly mutants: ReadonlyArray<ReportMutant> }>
}

const verifyReachesVerdict = (expect: Expect, run: ExecResult): Check => expect(run.exitCode).toBe(0)

const verifyCounts = (expect: Expect, verdict: RunEvent.VerdictReached): Check =>
  expect({
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    killed: verdict.counts.killed,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
    survived: verdict.counts.survived,
    timeout: verdict.counts.timeout,
  }).toStrictEqual({
    compileErrors: 0,
    ignored: 0,
    killed: VM_VITEST_ORACLE.killed,
    noCoverage: VM_VITEST_ORACLE.noCoverage,
    pending: 0,
    runtimeErrors: 0,
    survived: VM_VITEST_ORACLE.survived,
    timeout: 0,
  })

const verifyMutantTally = (expect: Expect, events: ReadonlyArray<RunEvent.RunEvent>): Check => {
  const reported = events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
    .map((mutant) => `${mutant.mutator}:${mutant.status}`)

  return expect({
    reportedCount: reported.length,
    tally: tallyOf(Object.keys(VM_VITEST_ORACLE.mutantStatusTally), reported),
  }).toStrictEqual({
    reportedCount: 11,
    tally: VM_VITEST_ORACLE.mutantStatusTally,
  })
}

const verifyReportAttribution = (
  expect: Expect,
  mutants: ReadonlyArray<ReportMutant>,
  addMutant: ReportMutant,
): Check => {
  const killed = mutants.filter((mutant) => mutant.status === 'Killed')
  const survivors = mutants.filter((mutant) => mutant.status === 'Survived')
  const unkillableMutant = mutants.find((mutant) =>
    mutant.mutatorName === 'ArithmeticOperator' && mutant.status === 'Survived' &&
    mutant.location?.start?.line === 14
  )

  return expect({
    killedCount: killed.length,
    everyKillNamesATest: killed.every((mutant) => (mutant.killedBy?.length ?? 0) > 0),
    everySurvivorNamesNoTest: survivors.every((mutant) => (mutant.killedBy?.length ?? 0) === 0),
    unkillableMutantIsPresent: unkillableMutant !== undefined,
    addMutantKilledByCount: addMutant.killedBy?.length,
  }).toStrictEqual({
    killedCount: VM_VITEST_ORACLE.killed,
    everyKillNamesATest: true,
    everySurvivorNamesNoTest: true,
    unkillableMutantIsPresent: true,
    addMutantKilledByCount: 1,
  })
}

it.live('running a vitest-syntax suite through the in-memory runner', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'a fixture whose suite is written against vitest and verified in memory',
    prepareFixture(VM_FIXTURE_URL, 'vm-vitest-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'the CLI is executed with the in-memory runner',
    Effect.promise(() => fixture.run(['run'])),
  )
  const events = yield* Effect.promise(() => parseEventStream(run.stdout))
  const terminal = lastEvent(events)
  if (terminal._tag !== 'verdict') {
    throw new Error(`Expected terminal verdict event, received: ${terminal._tag}`)
  }

  yield* bddStep('Then', 'the run reaches a verdict with every mutant classified', verifyReachesVerdict(expect, run))
  yield* bddStep(
    'And',
    'the tallies match the vitest-runner oracle',
    verifyCounts(expect, terminal),
  )
  yield* bddStep(
    'And',
    'every reported mutant lands in the vitest-runner oracle tally',
    verifyMutantTally(expect, events),
  )
  const reportFile = terminal.reportFile
  if (reportFile === null || reportFile === '') {
    throw new Error('verdict carries no report file reference')
  }
  const reportText = yield* bddStep(
    'And',
    'the report attributes every kill to a concrete test',
    Effect.promise(() => fixture.readFile(reportFile)),
  )
  const report = JSON.parse(reportText) as MutationReport
  const mutants = Object.values(report.files).flatMap((file) => file.mutants)
  const addMutant = mutants.find((mutant) => mutant.mutatorName === 'ArithmeticOperator' && mutant.status === 'Killed')
  if (addMutant === undefined) {
    throw new Error('report carries no killed ArithmeticOperator mutant')
  }

  yield* bddStep(
    'And',
    'the report names a killer for every kill and none for a survivor',
    verifyReportAttribution(expect, mutants, addMutant),
  )
})
