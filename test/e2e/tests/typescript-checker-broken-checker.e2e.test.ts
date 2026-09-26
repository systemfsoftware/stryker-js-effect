import { it } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'
import { FIXTURE_URL, parseEventStream, verifyBrokenCheckerError } from './__fixtures__/typescript-checker.fixture.js'

it.live(
  'failing checker emits structured StageError carrying the diagnostic cause, not an empty crash',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture configured with a non-existent tsconfig path',
      prepareFixture(FIXTURE_URL, 'typescript-checker-broken-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'Stryker CLI runs expecting checker failure',
      Effect.promise(() => fixture.run(['run', 'stryker.broken-checker.config.ts'])),
    )
    const events = parseEventStream(run.stdout)

    yield* bddStep(
      'Then',
      'the run fails with structured error payload without crash',
      verifyBrokenCheckerError(expect, run, events),
    )
  },
  { timeout: 300_000 },
)
