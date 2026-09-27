import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js'
import type { Check, Expect } from '@systemfsoftware/vitest'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, terminalEvent } from './__fixtures__/machine-stream.fixture.js'

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)

const verifySabotageBreach = (
  expect: Expect,
  run: ExecResult,
  terminal: RunEvent.RunEvent,
): Check =>
  expect({
    exitCode: run.exitCode,
    terminalTag: terminal._tag,
    survivedIsPositive: terminal._tag === 'verdict' ? terminal.counts.survived > 0 : false,
    breakThreshold: terminal._tag === 'verdict' ? terminal.thresholds.break : null,
  }).toStrictEqual({
    exitCode: 1,
    terminalTag: 'verdict',
    survivedIsPositive: true,
    breakThreshold: 100,
  })

const Feature = makeFeature({ it })

Feature('Failing the break threshold on survived mutants', { timeout: 900_000 })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM for the packaged enterprise workspace and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A sabotage run over an imperfect suite breaches the break threshold',
      Gherkin.Do.pipe(
        When('the CLI executes with an active break threshold on an imperfect suite')(
          'run',
          () =>
            runStryker({
              fixture: ENTERPRISE_FIXTURE_URL,
              label: 'enterprise-monorepo-fixture',
              args: ['run', 'stryker.sabotage.config.ts'],
            }),
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal event of the decoded stream is read')(
          'terminal',
          (s) => terminalEvent(s.events),
        ),
        Then('the CLI detects the surviving mutant, breaches the threshold, and exits non-zero')((s, expect) =>
          verifySabotageBreach(expect, s.run.output.result, s.terminal)
        ),
      ),
    )
  })
