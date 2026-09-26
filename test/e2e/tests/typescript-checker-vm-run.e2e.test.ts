import { it } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'
import {
  FIXTURE_URL,
  lastEvent,
  parseEventStream,
  verifyDiskReport,
  verifyDiskStream,
  verifyMutantStreamAndActionables,
  verifyProcessAndStreamIntegrity,
  verifyVerdictCounts,
} from './__fixtures__/typescript-checker.fixture.js'

it.live(
  'the in-memory vm runner exits on a verdict with compile errors and killed mutants, persists structured json report artifact on container disk and matches contract, persists mutation-stream.jsonl on disk matching stdout events',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'an in-memory vm runner fixture installed in the container',
      prepareFixture(FIXTURE_URL, 'typescript-checker-vm-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'Stryker CLI runs with stryker.vm.config.ts',
      Effect.promise(() => fixture.run(['run', 'stryker.vm.config.ts'])),
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
    yield* bddStep(
      'Then',
      'the persisted reports/mutation/mutation.json conforms to the schema',
      Effect.gen(function*() {
        const reportText = yield* Effect.promise(() => fixture.readFile('reports/mutation/mutation.json'))
        return yield* verifyDiskReport(expect, run, reportText)
      }),
    )
    yield* bddStep(
      'Then',
      'the persisted stream on disk is byte-complete and tags match stdout',
      Effect.gen(function*() {
        const streamFileContent = yield* Effect.promise(() => fixture.readFile('reports/mutation-stream.jsonl'))
        return yield* verifyDiskStream(expect, events, parseEventStream(streamFileContent))
      }),
    )
  },
)
