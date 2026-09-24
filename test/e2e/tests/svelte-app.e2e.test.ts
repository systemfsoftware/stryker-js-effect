import { RunEvent } from '@systemfsoftware/stryker-js'
import * as S from 'effect/Schema'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { type PreparedFixture, test } from './__fixtures__/microvm-harness.js'

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

const parseEventStream = async (stdout: string): Promise<ReadonlyArray<RunEvent.RunEvent>> =>
  Promise.all(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .map((line) => S.decodeUnknownPromise(RunEvent.RunEventWireLine)(line)),
  )

const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const stepVerifyCounts = (expect: ExpectStatic, verdict: RunEvent.VerdictReached): void => {
  expect.soft({
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    killed: verdict.counts.killed,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
    survived: verdict.counts.survived,
    timeout: verdict.counts.timeout,
  }).toEqual({
    compileErrors: 0,
    ignored: 0,
    killed: SVELTE_APP_ORACLE.killed,
    noCoverage: SVELTE_APP_ORACLE.noCoverage,
    pending: 0,
    runtimeErrors: 0,
    survived: SVELTE_APP_ORACLE.survived,
    timeout: 0,
  })
}

const stepVerifyFormats = (expect: ExpectStatic, events: ReadonlyArray<RunEvent.RunEvent>): void => {
  const formats = events.find((event): event is Extract<RunEvent.RunEvent, { _tag: 'formats' }> =>
    event._tag === 'formats'
  )
  if (formats === undefined) {
    throw new Error('the stream carries no formats event')
  }
  expect.soft(formats.rows).toContainEqual({
    extension: '.svelte',
    formatId: 'svelte',
    ownerModule: '@systemfsoftware/stryker-js-svelte',
    language: 'svelte',
  })
}

const stepVerifyNoSvelteSkipped = (expect: ExpectStatic, events: ReadonlyArray<RunEvent.RunEvent>): void => {
  const skipped = events.find((event): event is Extract<RunEvent.RunEvent, { _tag: 'skipped' }> =>
    event._tag === 'skipped'
  )
  expect.soft(skipped?.files.filter((file) => file.file.endsWith('.svelte')) ?? []).toEqual([])
}

const stepVerifyMutants = (expect: ExpectStatic, events: ReadonlyArray<RunEvent.RunEvent>): void => {
  const reported = events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
    .map((mutant) => `${mutant.file}:${mutant.location.start.line}:${mutant.mutator}:${mutant.status}`)
    .toSorted()
  expect.soft(reported).toEqual([...SVELTE_APP_ORACLE.mutants].toSorted())
}

test(
  'running a vitest suite through the svelte framework plugin',
  { timeout: 300_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent.RunEvent>
    let verdict: RunEvent.VerdictReached

    await bdd.given('a real Svelte 5 application with tests mounted through testing-library', async () => {
      fixture = await prepareFixture(SVELTE_FIXTURE_URL, 'svelte-app-fixture')
    })

    await bdd.when('the packed CLI runs it with the vitest runner and the svelte plugin', async () => {
      run = await fixture.run(['run'])
      events = await parseEventStream(run.stdout)
      const terminal = lastEvent(events)
      if (terminal._tag !== 'verdict') {
        throw new Error(`Expected terminal verdict event, received: ${terminal._tag}`)
      }
      verdict = terminal
    })

    await bdd.thenAssert('the run reaches a verdict instead of a run failure', () => {
      expect.soft(run.exitCode).toBe(0)
    })

    await bdd.and('the formats registry attributes .svelte to the svelte plugin', () => {
      stepVerifyFormats(expect, events)
    })

    await bdd.and('no skipped event names a .svelte file', () => {
      stepVerifyNoSvelteSkipped(expect, events)
    })

    await bdd.and('every mutant lands on its authored line with its authored status', () => {
      stepVerifyMutants(expect, events)
    })

    await bdd.and('the per-status tally matches the svelte-app oracle', () => {
      stepVerifyCounts(expect, verdict)
    })
  },
)
