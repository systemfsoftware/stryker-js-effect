import { RunEvent } from '@systemfsoftware/stryker-js'
import * as S from 'effect/Schema'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { type PreparedFixture, test } from './__fixtures__/microvm-harness.js'

const FIXTURE_URL = new URL('../testResources/vitest-nested-describe-fixture', import.meta.url)

interface MutantEntry {
  readonly mutatorName: string
  readonly status: string
  readonly killedBy?: ReadonlyArray<string>
}

interface MutationReport {
  readonly files: Record<string, { readonly mutants: ReadonlyArray<MutantEntry> }>
}

const MUTATION_ORACLE = {
  killed: 4,
  survived: 0,
  noCoverage: 0,
  compileErrors: 0,
  runtimeErrors: 0,
  timeout: 0,
  ignored: 0,
  pending: 0,
} as const

const NESTED_FILE_SUFFIX = 'src/nested.ts'
const TOP_FILE_SUFFIX = 'src/top.ts'

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

const mutantsOf = (report: MutationReport, fileSuffix: string): ReadonlyArray<MutantEntry> => {
  const entry = Object.entries(report.files).find(([file]) => file.replaceAll('\\', '/').endsWith(fileSuffix))
  if (entry === undefined) {
    throw new Error(`mutation report carries no file entry ending in ${fileSuffix}`)
  }
  return entry[1].mutants
}

const stepVerifyVerdict = (expect: ExpectStatic, run: ExecResult, verdict: RunEvent.VerdictReached): void => {
  expect.soft(run.exitCode).toBe(0)
  expect.soft({
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    killed: verdict.counts.killed,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
    survived: verdict.counts.survived,
    timeout: verdict.counts.timeout,
  }).toEqual(MUTATION_ORACLE)
}

const stepVerifyNestedCoveredMutantIsKilled = (
  expect: ExpectStatic,
  report: MutationReport,
): void => {
  const nestedMutants = mutantsOf(report, NESTED_FILE_SUFFIX)
  expect.soft(nestedMutants).toHaveLength(2)
  for (const mutant of nestedMutants) {
    expect.soft(mutant.status).toBe('Killed')
    expect.soft(mutant.killedBy?.length ?? 0).toBeGreaterThan(0)
  }
}

const stepVerifyTopLevelMutantKeepsItsVerdict = (
  expect: ExpectStatic,
  report: MutationReport,
): void => {
  const topMutants = mutantsOf(report, TOP_FILE_SUFFIX)
  expect.soft(topMutants).toHaveLength(2)
  for (const mutant of topMutants) {
    expect.soft(mutant.status).toBe('Killed')
    expect.soft(mutant.killedBy?.length ?? 0).toBeGreaterThan(0)
  }
}

test('the vitest runner kills the mutants whose only covering tests sit inside describe blocks', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent.RunEvent>
  let verdict: RunEvent.VerdictReached
  let report: MutationReport

  await bdd.given('a vitest fixture whose nested-covered source is installed in the container', async () => {
    fixture = await prepareFixture(FIXTURE_URL, 'vitest-nested-describe')
  })

  await bdd.when('Stryker CLI runs with per-test coverage analysis', async () => {
    run = await fixture.run(['run'])
    events = await parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }
    verdict = terminal
    report = JSON.parse(await fixture.readFile('reports/mutation/mutation.json')) as MutationReport
  })

  await bdd.thenAssert('the run reaches a verdict killing every mutant', () => {
    stepVerifyVerdict(expect, run, verdict)
  })

  await bdd.and('the mutants covered only by the nested suites are Killed', () => {
    stepVerifyNestedCoveredMutantIsKilled(expect, report)
  })

  await bdd.and('the mutants covered only by the top-level test keep their verdict', () => {
    stepVerifyTopLevelMutantKeepsItsVerdict(expect, report)
  })
})
