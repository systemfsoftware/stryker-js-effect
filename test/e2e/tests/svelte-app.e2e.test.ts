import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const SVELTE_FIXTURE_URL = new URL('../testResources/svelte-app-fixture', import.meta.url)

type FormatsEvent = Extract<RunEvent.RunEvent, { readonly _tag: 'formats' }>

const formatsOf = (events: ReadonlyArray<RunEvent.RunEvent>): FormatsEvent => {
  const formats = events.find((event): event is FormatsEvent => event._tag === 'formats')
  if (formats === undefined) {
    throw new Error('the stream carries no formats event')
  }
  return formats
}

const skippedSvelteFilesOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<{ readonly file: string }> => {
  const skipped = events.find((event): event is Extract<RunEvent.RunEvent, { readonly _tag: 'skipped' }> =>
    event._tag === 'skipped'
  )
  return skipped?.files.filter((file) => file.file.endsWith('.svelte')) ?? []
}

const verifyReachesVerdict = (expect: Expect, run: ExecResult): Check => expect(run.exitCode).toBe(0)

const verifyFormats = (expect: Expect, formats: FormatsEvent): Check =>
  expect(formats.rows).toContainEqual({
    extension: '.svelte',
    formatId: 'svelte',
    ownerModule: '@systemfsoftware/stryker-js-svelte',
    language: 'svelte',
  })

const verifyNoSvelteSkipped = (expect: Expect, skippedFiles: ReadonlyArray<{ readonly file: string }>): Check =>
  expect(skippedFiles).toEqual([])

const Feature = makeFeature({ it })

Feature('Running a vitest suite through the svelte framework plugin', { timeout: 300_000 })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'The svelte plugin kills every authored mutant of a real Svelte 5 application',
      Gherkin.Do.pipe(
        When('the packed CLI runs a real Svelte 5 application with the vitest runner and the svelte plugin')(
          'run',
          () => runStryker({ fixture: SVELTE_FIXTURE_URL, label: 'svelte-app-fixture', args: ['run'] }),
        ),
        Then('the run reaches a verdict instead of a run failure')((s, expect) =>
          verifyReachesVerdict(expect, s.run.output.result)
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the formats registry carried by the decoded stream is read')(
          'formats',
          (s) => Effect.sync(() => formatsOf(s.events)),
        ),
        Then('the formats registry attributes .svelte to the svelte plugin')((s, expect) =>
          verifyFormats(expect, s.formats)
        ),
        When('the files the decoded stream reports as skipped are read')(
          'skippedFiles',
          (s) => Effect.succeed(skippedSvelteFilesOf(s.events)),
        ),
        Then('no skipped event names a .svelte file')((s, expect) => verifyNoSvelteSkipped(expect, s.skippedFiles)),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        When('the report the verdict names is read and decoded')(
          'report',
          (s) => readReportOf(s.verdict, s.run.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation and the verdict tallies agree')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: 'svelte-app-fixture',
            slice: 'stryker.config.ts',
            report: s.report,
            verdict: s.verdict,
          })
        ),
      ),
    )
  })
