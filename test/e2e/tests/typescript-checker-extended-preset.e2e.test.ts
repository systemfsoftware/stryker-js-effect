import { it } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'
import {
  FIXTURE_URL,
  lastEvent,
  parseEventStream,
  verifyPresetMutants,
  verifyProcessAndStreamIntegrity,
} from './__fixtures__/typescript-checker.fixture.js'

it.live(
  'reports a mutant that breaks a rule inherited from an extended preset as a compile error',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture whose project config extends a preset that enables unchecked indexed access',
      prepareFixture(FIXTURE_URL, 'typescript-checker-preset-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'the CLI checks a source whose conditional fallback guards an indexed read',
      Effect.promise(() => fixture.run(['run', 'stryker.preset.config.ts'])),
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
    yield* bddStep(
      'And',
      'the mutant that drops the fallback is a compile error',
      verifyPresetMutants(expect, events, terminal),
    )
  },
  { timeout: 300_000 },
)
