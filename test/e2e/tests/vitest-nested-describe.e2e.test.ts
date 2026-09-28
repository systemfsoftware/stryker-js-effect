import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Check, Expect } from '@systemfsoftware/vitest'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const FIXTURE_URL = new URL('../testResources/vitest-nested-describe-fixture', import.meta.url)

const GREETING_MUTATOR = 'StringLiteral'
const GREETING_FILE_SUFFIX = 'nested.ts'

interface BailObservation {
  readonly found: boolean
  readonly status?: string
  readonly testsExecuted?: number | null
}

const isMutantTested = (event: RunEvent.RunEvent): event is RunEvent.RunMutantTestedEvent =>
  event._tag === 'mutantTested'

const greetingBailObservation = (events: ReadonlyArray<RunEvent.RunEvent>): BailObservation => {
  const mutant = events.filter(isMutantTested).find(
    (event) => event.mutatorName === GREETING_MUTATOR && event.fileName.endsWith(GREETING_FILE_SUFFIX),
  )
  return mutant === undefined
    ? { found: false }
    : {
      found: true,
      status: mutant.status,
      testsExecuted: mutant.cost === null ? null : mutant.cost.testsExecuted,
    }
}

const verifyReachesVerdict = (expect: Expect, run: ExecResult): Check => expect(run.exitCode).toBe(0)

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
        Then('the run reaches a verdict')((s, expect) => verifyReachesVerdict(expect, s.run.output.result)),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        Then('the greeting mutant run stops at the first test that kills it')((s, expect) =>
          expect(greetingBailObservation(s.events)).toStrictEqual({ found: true, status: 'Killed', testsExecuted: 1 })
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        When('the report the verdict names is read and decoded')(
          'report',
          (s) => readReportOf(s.verdict, s.run.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation and the verdict tallies agree')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: 'vitest-nested-describe-fixture',
            slice: 'stryker.config.ts',
            report: s.report,
            verdict: s.verdict,
          })
        ),
      ),
    )
  })
