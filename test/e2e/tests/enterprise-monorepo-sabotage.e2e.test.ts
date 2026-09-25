import { RunEvent } from '@systemfsoftware/stryker-js'
import { it } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent.RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEvent.RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

it.live(
  'sabotage verification: failing the break threshold on survived mutants causes non-zero process exit',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a packaged enterprise workspace in the container',
      prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-monorepo-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'the CLI executes with an active break threshold on an imperfect suite',
      Effect.promise(() => fixture.run(['run', 'stryker.sabotage.config.ts'])),
    )
    const events = parseEventStream(run.stdout)
    const terminal = lastEvent(events)

    yield* bddStep(
      'Then',
      'the CLI detects the surviving mutant, breaches the threshold, and exits non-zero',
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
      }),
    )
  },
  { timeout: 900_000 },
)
