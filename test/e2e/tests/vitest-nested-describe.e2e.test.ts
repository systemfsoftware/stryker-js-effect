import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'

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

const verifyMutantsOf = (expect: Expect, mutants: ReadonlyArray<MutantEntry>): Check =>
  expect({
    mutantCount: mutants.length,
    distinctStatuses: [...new Set(mutants.map((mutant) => mutant.status))],
    everyMutantNamesAKiller: mutants.every((mutant) => (mutant.killedBy?.length ?? 0) > 0),
  }).toStrictEqual({
    mutantCount: 2,
    distinctStatuses: ['Killed'],
    everyMutantNamesAKiller: true,
  })

const Feature = makeFeature({ it })

Feature('Killing the mutants whose only covering tests sit inside describe blocks')
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'The vitest runner kills the mutants whose only covering tests sit inside describe blocks',
      Gherkin.Do.pipe(
        When('the CLI runs in machine mode with per-test coverage analysis against a nested-describe fixture')(
          'run',
          () => runStryker({ fixture: FIXTURE_URL, label: 'vitest-nested-describe', args: ['run'] }),
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        Then('the run reaches a verdict killing every mutant')((s, expect) =>
          verifyVerdict(expect, s.run.output.result, s.verdict)
        ),
        When('the persisted mutation report is read and decoded')(
          'report',
          (s) =>
            Effect.map(
              s.run.output.readFile('reports/mutation/mutation.json'),
              (text) => JSON.parse(text) as MutationReport,
            ),
        ),
        When('the mutants covered only by the nested suites are read')(
          'nestedMutants',
          (s) => Effect.sync(() => mutantsOf(s.report, NESTED_FILE_SUFFIX)),
        ),
        Then('the mutants covered only by the nested suites are Killed')((s, expect) =>
          verifyMutantsOf(expect, s.nestedMutants)
        ),
        When('the mutants covered only by the top-level test are read')(
          'topMutants',
          (s) => Effect.sync(() => mutantsOf(s.report, TOP_FILE_SUFFIX)),
        ),
        Then('the mutants covered only by the top-level test keep their verdict')((s, expect) =>
          verifyMutantsOf(expect, s.topMutants)
        ),
      ),
    )
  })
