import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'

import { type ShapeEntry, shapes } from '../testResources/effect-concurrency/shapes.js'
import { effectConcurrencyFixtureFiles, type FixtureFile } from './__fixtures__/effect-concurrency-files.js'
import { instrument } from './__fixtures__/instrument.js'

const OPT_IN_MUTATOR_NAMES: readonly string[] = ['AtomicUpdateSplit', 'SynchronizationRemoval', 'FinalizerEscape']

const R6_PAIRS: Record<string, true> = {
  'Ref.modify': true,
  'Ref.modifySome': true,
  'Ref.update': true,
  'Ref.updateSome': true,
  'Ref.updateAndGet': true,
  'Ref.getAndUpdate': true,
  'SynchronizedRef.modify': true,
  'SynchronizedRef.modifySome': true,
  'SynchronizedRef.update': true,
  'SynchronizedRef.updateSome': true,
  'SynchronizedRef.updateAndGet': true,
  'SynchronizedRef.getAndUpdate': true,
}

const R7_PAIRS: Record<string, true> = {
  'Semaphore.withPermits': true,
  'Semaphore.withPermit': true,
  'Effect.uninterruptible': true,
  'Effect.uninterruptibleMask': true,
}

const R8_PAIRS: Record<string, true> = {
  'Effect.ensuring': true,
  'Effect.onExit': true,
  'Effect.onError': true,
  'Effect.onInterrupt': true,
  'Effect.acquireRelease': true,
  'Effect.acquireUseRelease': true,
}

const pairOf = (entry: ShapeEntry): string => `${entry.module}.${entry.operation}`

const Feature = makeFeature({ it })

Feature('Keeping the Effect concurrency faults off unless a run asks for them')
  .live('reads fixture files from disk and parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenario }) => {
    scenario(
      'A run that names no concurrency mutator finds none of them, and every fixture still carries ordinary mutants',
      Gherkin.Do.pipe(
        Given('every concurrency fixture module has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the files are instrumented without naming any concurrency mutator')(
          'result',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(
              fixtures.map((fixture) => ({ name: fixture.name, content: fixture.content, mutate: true })),
              { ignorers: [], excludedMutations: [] },
            ),
        ),
        Then('the report names no concurrency mutator, and no fixture came out empty')((
          { fixtures, result }: { fixtures: readonly FixtureFile[]; result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            concurrencyMutants: result.mutants
              .filter((mutant) => OPT_IN_MUTATOR_NAMES.includes(mutant.mutatorName))
              .map((mutant) => `${mutant.fileName}:${mutant.location.start.line} ${mutant.mutatorName}`),
            emptyFiles: fixtures
              .filter((fixture) => !result.mutants.some((mutant) => mutant.fileName === fixture.name))
              .map((fixture) => fixture.name),
          }).toEqual({ concurrencyMutants: [], emptyFiles: [] })
        ),
      ),
    )

    scenario(
      'The shape table names exactly the operations the product contract lists',
      Gherkin.Do.pipe(
        Given('the shape table of covered calls')('table', () => Effect.succeed(shapes)),
        When('the module and operation pairs are collected from the table')(
          'pairs',
          ({ table }: { table: readonly ShapeEntry[] }) =>
            Effect.succeed(
              Object.keys(Object.fromEntries(table.map((entry) => [pairOf(entry), true]))).sort(),
            ),
        ),
        Then('they match the contract lists exactly, nothing more and nothing missing')((
          { pairs }: { pairs: readonly string[] },
          expect,
        ) => expect(pairs).toEqual(Object.keys({ ...R6_PAIRS, ...R7_PAIRS, ...R8_PAIRS }).sort())),
      ),
    )
  })
