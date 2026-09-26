import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, terminalEvent } from './__fixtures__/machine-stream.fixture.js'

const FAILING_DRY_RUN_RUNTIME_ERROR_CODE = 3
const FAILING_FIXTURE_URL = new URL('../testResources/failing-fixture', import.meta.url)
const FAILING_TEST_NAME = 'isEven reports three as even'

const verifyFailingDryRunExit = (expect: Expect, run: ExecResult): Check =>
  expect(run.exitCode).toBe(FAILING_DRY_RUN_RUNTIME_ERROR_CODE)

const verifyStreamCleanliness = (expect: Expect, events: ReadonlyArray<RunEvent.RunEvent>): Check =>
  expect({
    hasEvents: events.length > 0,
    everyTagIsAString: events.every((event) => typeof event._tag === 'string'),
  }).toStrictEqual({ hasEvents: true, everyTagIsAString: true })

const verifyTypedErrorDocument = (
  expect: Expect,
  terminal: RunEvent.RunEvent,
  events: ReadonlyArray<RunEvent.RunEvent>,
): Check => {
  const errorDocument: RunEvent.RunFailed | undefined = terminal._tag === 'error' ? terminal : undefined
  const tags = events.map((event) => event._tag)

  return expect({
    terminalTag: terminal._tag,
    schemaVersion: errorDocument?.schemaVersion,
    code: errorDocument?.code,
    errorIsString: typeof errorDocument?.error === 'string',
    remediationHasContent: /\S/.test(errorDocument?.remediation ?? ''),
    carriesVerdict: tags.includes('verdict'),
  }).toStrictEqual({
    terminalTag: 'error',
    schemaVersion: '1.1',
    code: FAILING_DRY_RUN_RUNTIME_ERROR_CODE,
    errorIsString: true,
    remediationHasContent: true,
    carriesVerdict: false,
  })
}

const verifyErrorDocumentNamesTheFailingTest = (expect: Expect, errorText: string): Check =>
  expect({
    namesFailingTest: errorText.includes(FAILING_TEST_NAME),
    carriesFailureMessage: /\S/.test(errorText) && errorText.includes('expected'),
  }).toStrictEqual({ namesFailingTest: true, carriesFailureMessage: true })

const Feature = makeFeature({ it })

Feature('Failing a mutation run at the process boundary')
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A dry-run failure reports an error document instead of a verdict',
      Gherkin.Do.pipe(
        When('the CLI runs in machine mode against a fixture configured to fail during dry run')(
          'run',
          () => runStryker({ fixture: FAILING_FIXTURE_URL, label: 'failing-fixture', args: ['run'] }),
        ),
        Then('the process exits with the failing dry run code')((s, expect) =>
          verifyFailingDryRunExit(expect, s.run.output.result)
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        Then('every machine event is a tagged record')((s, expect) => verifyStreamCleanliness(expect, s.events)),
        When('the terminal event of the decoded stream is read')('terminal', (s) => terminalEvent(s.events)),
        Then('the run emits a structured error document and no verdict')((s, expect) =>
          verifyTypedErrorDocument(expect, s.terminal, s.events)
        ),
        When('the failure text carried by the error document is read')(
          'errorText',
          (s) => Effect.succeed(s.terminal._tag === 'error' ? s.terminal.error : ''),
        ),
        Then('the error document names the failing test with its failure message')((s, expect) =>
          verifyErrorDocumentNamesTheFailingTest(expect, s.errorText)
        ),
      ),
    )
  })
