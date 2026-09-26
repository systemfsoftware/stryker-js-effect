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

it.live(
  'keeps a composite project include list so the dry run passes and its mutants are checked',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture whose application config lists the files it compiles and references a library that leaves a broken file out of its file list',
      prepareFixture(FIXTURE_URL, 'typescript-checker-preservation-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'the CLI checks the application in project-reference mode',
      Effect.promise(() => fixture.run(['run', 'stryker.preservation.config.ts'])),
    )
    const events = parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }

    yield* bddStep(
      'Then',
      'the run reaches a verdict and checks the application mutants',
      verifyProcessAndStreamIntegrity(expect, run, events),
    )
    yield* bddStep('And', 'the verdict carries the oracle counts', verifyVerdictCounts(expect, terminal))
    yield* bddStep(
      'And',
      'the mutant stream matches the oracle and every event carries one run id',
      verifyMutantStreamAndActionables(expect, events, terminal),
    )
  },
  { timeout: 300_000 },
)
