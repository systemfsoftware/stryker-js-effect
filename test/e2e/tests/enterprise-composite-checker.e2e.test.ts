import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'

import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { compareAnnotatedRun, statusesOf } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const ENTERPRISE_FIXTURE = 'enterprise-monorepo-fixture'
const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const CHECKER_SLICE = 'stryker.checker.config.ts'

const verifyExit = (expect: Expect, run: ExecResult): Check =>
  expect({ exitCode: run.exitCode }).toStrictEqual({ exitCode: 0 })

const Feature = makeFeature({ it })

Feature('Checking project references and cross-package compile errors', { timeout: 900_000 })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM for the enterprise fixture and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A run with composite checker configuration confirms the authored cross-package compile errors',
      Gherkin.Do.pipe(
        When('the CLI executes with composite checker configuration')(
          'run',
          () =>
            runStryker({
              fixture: ENTERPRISE_FIXTURE_URL,
              label: 'enterprise-checker-fixture',
              args: ['run', CHECKER_SLICE],
            }),
        ),
        Then('the process exited cleanly')((s, expect) => verifyExit(expect, s.run.output.result)),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal verdict of the decoded stream is read')(
          'verdict',
          (s) => verdictEvent(s.events),
        ),
        When('the persisted report of the run is read from its fork')(
          'report',
          (s) => readReportOf(s.verdict, s.run.output.readFile),
        ),
        Then('every reported mutant matches its annotation and the checker reported a compile error')(
          (s, expect) =>
            Effect.map(
              compareAnnotatedRun({
                fixture: ENTERPRISE_FIXTURE,
                slice: CHECKER_SLICE,
                report: s.report,
                verdict: s.verdict,
              }),
              (comparison) =>
                expect({ ...comparison.actual, reportsACompileError: statusesOf(s.report).includes('CompileError') })
                  .toStrictEqual({ ...comparison.expected, reportsACompileError: true }),
            ),
        ),
      ),
    )
  })
