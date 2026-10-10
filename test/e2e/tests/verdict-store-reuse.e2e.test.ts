import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect, Layer } from 'effect'

import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { S3Emulator } from '../src/Harness/s3-emulator.service.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, reuseEventOf, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const FIXTURE_URL = new URL('../testResources/verdict-store-fixture', import.meta.url)
const S3_CONFIG = 'stryker.s3.config.ts'
const BUCKET = 'stryker-verdicts'
const REUSE_FLOOR = 0.95
const STDERR_TAIL_CHARS = 2000

const failureTailOf = (run: ExecResult): string => run.exitCode === 0 ? '' : run.stderr.slice(-STDERR_TAIL_CHARS)

const reuseRatioOf = (reuse: RunEvent.ReuseReported): number => reuse.reused / Math.max(reuse.reused + reuse.ran, 1)

const verifyReuseAcrossMachines = (
  expect: Expect,
  runs: {
    readonly first: ExecResult
    readonly second: ExecResult
    readonly firstReuse: RunEvent.ReuseReported
    readonly secondReuse: RunEvent.ReuseReported
  },
): Check =>
  expect({
    firstFailure: failureTailOf(runs.first),
    secondFailure: failureTailOf(runs.second),
    firstRan: runs.firstReuse.ran > 0,
    firstReused: runs.firstReuse.reused,
    firstWithoutPriorEntry: runs.firstReuse.refused.noPriorRecord,
    secondMeetsTheReuseFloor: reuseRatioOf(runs.secondReuse) >= REUSE_FLOOR,
    secondUnreadable: runs.secondReuse.refused.entryUnreadable,
    secondStoreUnavailable: runs.secondReuse.refused.storeUnavailable,
  }).toStrictEqual({
    firstFailure: '',
    secondFailure: '',
    firstRan: true,
    firstReused: 0,
    firstWithoutPriorEntry: runs.firstReuse.ran,
    secondMeetsTheReuseFloor: true,
    secondUnreadable: 0,
    secondStoreUnavailable: 0,
  })

const Feature = makeFeature({ it })

Feature('Reusing verdicts across machines through a shared S3 verdict store', { timeout: 900_000 })
  .withLayer(Layer.merge(E2eHarnessLive, S3Emulator.layer))
  .live(
    'boots warm microVMs that run the packed CLI against an emulate S3 bucket on the host, exporting spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'An unchanged re-run on a fresh machine reuses at least 95% of the verdicts the first machine stored',
      Gherkin.Do.pipe(
        Given('an empty verdict bucket the microVMs reach on the host')(
          'store',
          () =>
            Effect.gen(function*() {
              const emulator = yield* S3Emulator
              yield* emulator.emptyBucket(BUCKET)
              return { ...emulator.guestEnvironment, VERDICT_STORE_ENDPOINT: emulator.guestEndpoint }
            }),
        ),
        When('the CLI runs the fixture incrementally on one fresh microVM')(
          'first',
          (s) =>
            runStryker({
              fixture: FIXTURE_URL,
              label: 'verdict-store-first-machine',
              args: ['run', S3_CONFIG, '--incremental'],
              env: s.store,
            }),
        ),
        When('the CLI runs the unchanged fixture incrementally on a second fresh microVM')(
          'second',
          (s) =>
            runStryker({
              fixture: FIXTURE_URL,
              label: 'verdict-store-second-machine',
              args: ['run', S3_CONFIG, '--incremental'],
              env: s.store,
            }),
        ),
        When('both runs report their reuse counts on their own event streams')(
          'reuse',
          (s) =>
            Effect.all({
              first: Effect.flatMap(decodeStream(s.first.output.result.stdout), reuseEventOf),
              second: Effect.flatMap(decodeStream(s.second.output.result.stdout), reuseEventOf),
            }),
        ),
        Then('the first run reuses nothing and the second reuses at least 95% with no unreadable entry')((s, expect) =>
          verifyReuseAcrossMachines(expect, {
            first: s.first.output.result,
            second: s.second.output.result,
            firstReuse: s.reuse.first,
            secondReuse: s.reuse.second,
          })
        ),
        When('the terminal verdict of the second run event stream is read')(
          'verdict',
          (s) => Effect.flatMap(decodeStream(s.second.output.result.stdout), verdictEvent),
        ),
        When('the report the verdict names is read and decoded')(
          'report',
          (s) => readReportOf(s.verdict, s.second.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation and the verdict tallies agree')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: 'verdict-store-fixture',
            slice: 'stryker.s3.config.ts',
            report: s.report,
            verdict: s.verdict,
          })
        ),
      ),
    )
  })
