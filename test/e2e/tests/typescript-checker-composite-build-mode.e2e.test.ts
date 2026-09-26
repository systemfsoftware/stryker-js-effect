import { it } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'
import {
  FIXTURE_URL,
  lastEvent,
  parseEventStream,
  verifyMutantStreamAndActionables,
  verifyProcessAndStreamIntegrity,
  verifyVerdictCounts,
} from './__fixtures__/typescript-checker.fixture.js'

it.live('exercises TypeScript composite project references in build mode', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'a fixture with composite project references',
    prepareFixture(FIXTURE_URL, 'typescript-checker-references-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'Stryker CLI runs with build-mode project references config',
    Effect.promise(() => fixture.run(['run', 'stryker.references.config.ts'])),
  )
  const events = parseEventStream(run.stdout)
  const terminal = lastEvent(events)
  if (terminal._tag !== 'verdict') {
    throw new Error(`Expected verdict event, received: ${terminal._tag}`)
  }

  yield* bddStep(
    'Then',
    'the process protocol and stream invariants hold',
    verifyProcessAndStreamIntegrity(expect, run, events),
  )
  yield* bddStep('And', 'the verdict carries the oracle counts', verifyVerdictCounts(expect, terminal))
  yield* bddStep(
    'And',
    'the mutant stream matches the oracle and every event carries one run id',
    verifyMutantStreamAndActionables(expect, events, terminal),
  )
})
