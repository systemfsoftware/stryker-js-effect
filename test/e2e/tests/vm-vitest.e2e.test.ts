import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import type { SandboxForkFailure } from '../src/Harness/harness-failure.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, MachineStreamError, verdictEvent } from './__fixtures__/machine-stream.fixture.js'

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

const reportedOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutantTested' }> => event._tag === 'mutantTested')
    .map((mutant) => `${mutant.mutatorName}:${mutant.status}`)

const mutantsOf = (report: MutationReport): ReadonlyArray<ReportMutant> =>
  Object.values(report.files).flatMap((file) => file.mutants)

const killedAddMutantOf = (report: MutationReport): ReportMutant => {
  const addMutant = mutantsOf(report).find((mutant) =>
    mutant.mutatorName === 'ArithmeticOperator' && mutant.status === 'Killed'
  )
  if (addMutant === undefined) {
    throw new Error('report carries no killed ArithmeticOperator mutant')
  }
  return addMutant
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

const verifyMutantTally = (expect: Expect, reported: ReadonlyArray<string>): Check =>
  expect({
    reportedCount: reported.length,
    tally: tallyOf(Object.keys(VM_VITEST_ORACLE.mutantStatusTally), reported),
  }).toStrictEqual({
    reportedCount: 11,
    tally: VM_VITEST_ORACLE.mutantStatusTally,
  })

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

const Feature = makeFeature({ it })

Feature('Running a vitest-syntax suite through the in-memory runner')
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'The in-memory runner reports the vitest-runner oracle verdict',
      Gherkin.Do.pipe(
        When('the CLI runs in machine mode against a fixture whose suite is written against vitest')(
          'run',
          () => runStryker({ fixture: VM_FIXTURE_URL, label: 'vm-vitest-fixture', args: ['run'] }),
        ),
        Then('the run reaches a verdict with every mutant classified')((s, expect) =>
          verifyReachesVerdict(expect, s.run.output.result)
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        Then('the tallies match the vitest-runner oracle')((s, expect) => verifyCounts(expect, s.verdict)),
        When('the reported mutants of the decoded stream are read')(
          'reported',
          (s) => Effect.succeed(reportedOf(s.events)),
        ),
        Then('every reported mutant lands in the vitest-runner oracle tally')((s, expect) =>
          verifyMutantTally(expect, s.reported)
        ),
        When('the mutation report the verdict points at is read and decoded')(
          'report',
          (s): Effect.Effect<MutationReport, MachineStreamError | SandboxForkFailure> => {
            const reportFile = s.verdict.reportFile
            if (reportFile === null || reportFile === '') {
              return Effect.fail(
                new MachineStreamError({ line: '', detail: 'verdict carries no report file reference' }),
              )
            }
            return Effect.map(s.run.output.readFile(reportFile), (text) => JSON.parse(text) as MutationReport)
          },
        ),
        Then('the report names a killer for every kill and none for a survivor')((s, expect) =>
          verifyReportAttribution(expect, mutantsOf(s.report), killedAddMutantOf(s.report))
        ),
      ),
    )
  })
