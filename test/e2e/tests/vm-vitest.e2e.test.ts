import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const VM_FIXTURE_URL = new URL('../testResources/vm-vitest-fixture', import.meta.url)

interface NamedNoCoverageMutant {
  readonly name: string
  readonly killedBy: ReadonlyArray<string>
}

const noCoverageMutantsOf = (report: Report.MutationTestResult): ReadonlyArray<NamedNoCoverageMutant> =>
  Object.values(report.files).flatMap((file) =>
    file.mutants
      .filter((mutant) => mutant.status === 'NoCoverage')
      .map((mutant) => ({
        name: `${mutant.mutatorName}@${mutant.location.start.line}`,
        killedBy: mutant.killedBy ?? [],
      }))
  )

const verifyReachesVerdict = (expect: Expect, run: ExecResult): Check => expect(run.exitCode).toBe(0)

const verifyNoCoverageMutantsNameNoKiller = (
  expect: Expect,
  mutants: ReadonlyArray<NamedNoCoverageMutant>,
): Check =>
  expect(mutants.filter((mutant) => mutant.killedBy.length > 0).map((mutant) => mutant.name)).toStrictEqual([])

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
        When('the report the verdict names is read and decoded')(
          'report',
          (s) => readReportOf(s.verdict, s.run.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation and the verdict tallies agree')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: 'vm-vitest-fixture',
            slice: 'stryker.config.ts',
            report: s.report,
            verdict: s.verdict,
          })
        ),
        When('the NoCoverage mutants of the report are read')(
          'noCoverage',
          (s) => Effect.sync(() => noCoverageMutantsOf(s.report)),
        ),
        Then('no NoCoverage mutant names a killer')((s, expect) =>
          verifyNoCoverageMutantsNameNoKiller(expect, s.noCoverage)
        ),
      ),
    )
  })
