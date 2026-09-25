import { RunEvent } from '@systemfsoftware/stryker-js'
import { it } from '@systemfsoftware/vitest'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'

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

const verifyVerdict = (expect: Expect, run: ExecResult, verdict: RunEvent.VerdictReached): Check =>
  expect({
    exitCode: run.exitCode,
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    killed: verdict.counts.killed,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
    survived: verdict.counts.survived,
    timeout: verdict.counts.timeout,
  }).toStrictEqual({ exitCode: 0, ...MUTATION_ORACLE })

const verifyMutantsOf = (expect: Expect, report: MutationReport, fileSuffix: string): Check => {
  const mutants = mutantsOf(report, fileSuffix)

  return expect({
    mutantCount: mutants.length,
    distinctStatuses: [...new Set(mutants.map((mutant) => mutant.status))],
    everyMutantNamesAKiller: mutants.every((mutant) => (mutant.killedBy?.length ?? 0) > 0),
  }).toStrictEqual({
    mutantCount: 2,
    distinctStatuses: ['Killed'],
    everyMutantNamesAKiller: true,
  })
}

it.live(
  'the vitest runner kills the mutants whose only covering tests sit inside describe blocks',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a vitest fixture whose nested-covered source is installed in the container',
      prepareFixture(FIXTURE_URL, 'vitest-nested-describe'),
    )
    const run = yield* bddStep(
      'When',
      'Stryker CLI runs with per-test coverage analysis',
      Effect.promise(() => fixture.run(['run'])),
    )
    const events = yield* Effect.promise(() => parseEventStream(run.stdout))
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }
    const reportText = yield* Effect.promise(() => fixture.readFile('reports/mutation/mutation.json'))
    const report = JSON.parse(reportText) as MutationReport

    yield* bddStep('Then', 'the run reaches a verdict killing every mutant', verifyVerdict(expect, run, terminal))
    yield* bddStep(
      'And',
      'the mutants covered only by the nested suites are Killed',
      verifyMutantsOf(expect, report, NESTED_FILE_SUFFIX),
    )
    yield* bddStep(
      'And',
      'the mutants covered only by the top-level test keep their verdict',
      verifyMutantsOf(expect, report, TOP_FILE_SUFFIX),
    )
  },
)
