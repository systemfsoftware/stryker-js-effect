import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, verdictEvent } from './__fixtures__/machine-stream.fixture.js'

const SVELTE_APP_ORACLE = {
  killed: 11,
  survived: 4,
  noCoverage: 0,
  mutants: [
    'src/Counter.svelte:7:ArithmeticOperator:Killed',
    'src/Counter.svelte:9:BlockStatement:Killed',
    'src/Counter.svelte:15:ArithmeticOperator:Survived',
    'src/Counter.svelte:16:ConditionalExpression:Killed',
    'src/Counter.svelte:16:ConditionalExpression:Survived',
    'src/Counter.svelte:16:EqualityOperator:Killed',
    'src/Counter.svelte:16:EqualityOperator:Survived',
    'src/Toggle.svelte:4:BooleanLiteral:Killed',
    'src/Toggle.svelte:7:BlockStatement:Killed',
    'src/Toggle.svelte:15:StringLiteral:Killed',
    'src/Toggle.svelte:15:StringLiteral:Killed',
    'src/lib/math.ts:1:ArithmeticOperator:Survived',
    'src/lib/math.ts:1:ArrowFunction:Killed',
    'src/lib/math.ts:3:ArrowFunction:Killed',
    'src/lib/math.ts:3:BooleanLiteral:Killed',
  ],
} as const

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
  const skipped = events.find((event): event is Extract<RunEvent.RunEvent, { _tag: 'skipped' }> =>
    event._tag === 'skipped'
  )
  return skipped?.files.filter((file) => file.file.endsWith('.svelte')) ?? []
}

const reportedOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutantTested' }> => event._tag === 'mutantTested')
    .map((mutant) => `${mutant.fileName}:${mutant.location.start.line}:${mutant.mutatorName}:${mutant.status}`)
    .toSorted()

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

const verifyMutants = (expect: Expect, reported: ReadonlyArray<string>): Check =>
  expect(reported).toEqual([...SVELTE_APP_ORACLE.mutants].toSorted())

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
    killed: SVELTE_APP_ORACLE.killed,
    noCoverage: SVELTE_APP_ORACLE.noCoverage,
    pending: 0,
    runtimeErrors: 0,
    survived: SVELTE_APP_ORACLE.survived,
    timeout: 0,
  })

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
        When('the reported mutants of the decoded stream are read')(
          'reported',
          (s) => Effect.succeed(reportedOf(s.events)),
        ),
        Then('every mutant lands on its authored line with its authored status')((s, expect) =>
          verifyMutants(expect, s.reported)
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        Then('the per-status tally matches the svelte-app oracle')((s, expect) => verifyCounts(expect, s.verdict)),
      ),
    )
  })
