import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Check, Expect } from '@systemfsoftware/vitest'

import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const ENTERPRISE_FIXTURE = 'enterprise-monorepo-fixture'
const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const EDGE_SLICE = 'stryker.edge.config.ts'

const verifyExit = (expect: Expect, run: ExecResult): Check =>
  expect({ exitCode: run.exitCode }).toStrictEqual({ exitCode: 0 })

const Feature = makeFeature({ it })

Feature('Excluding mutators and ignoring mutants in an enterprise fixture', { timeout: 900_000 })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM for the enterprise fixture and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A run with excluded mutator configuration confirms every annotation authored in its fixture',
      Gherkin.Do.pipe(
        When('the CLI executes with excluded mutator configuration')(
          'run',
          () =>
            runStryker({
              fixture: ENTERPRISE_FIXTURE_URL,
              label: 'enterprise-edge-fixture',
              args: ['run', EDGE_SLICE],
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
        Then('every reported mutant matches exactly one annotation and its status')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: ENTERPRISE_FIXTURE,
            slice: EDGE_SLICE,
            report: s.report,
            verdict: s.verdict,
          })
        ),
      ),
    )
  })
