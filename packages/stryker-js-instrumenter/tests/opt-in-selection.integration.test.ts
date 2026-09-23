import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { InstrumentError, InstrumentResult } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'
import { readdir, readFile } from 'node:fs/promises'
import { expect } from 'vitest'

import { instrument } from './__fixtures__/instrument.js'

const CONCURRENCY_MUTATOR_NAMES: readonly string[] = [
  'AtomicUpdateSplit',
  'SynchronizationRemoval',
  'FinalizerEscape',
]

const UNKNOWN_MUTATOR_NAME = 'AtomicUpdateSplt'

const MODULE_SOURCE = 'export const total = 1 + 1\n'

interface FixtureFile {
  readonly name: string
  readonly content: string
}

const FIXTURES_URL = new URL('./__fixtures__/effect-concurrency/', import.meta.url)

const loadFixtureFiles = async (): Promise<readonly FixtureFile[]> => {
  const entries = await readdir(FIXTURES_URL, { recursive: true })
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith('.ts'))
      .sort()
      .map(async (entry) => ({
        name: entry,
        content: await readFile(new URL(entry, FIXTURES_URL), 'utf8'),
      })),
  )
}

const filesToInstrument = (fixtures: readonly FixtureFile[]) =>
  fixtures.map((fixture) => ({ name: fixture.name, content: fixture.content, mutate: true }))

const concurrencyMutantsIn = (result: InstrumentResult): readonly string[] =>
  result.mutants
    .filter((mutant) => CONCURRENCY_MUTATOR_NAMES.includes(mutant.mutatorName))
    .map((mutant) => `${mutant.fileName} ${mutant.mutatorName}`)

const mutantLinesOf = (result: InstrumentResult): readonly string[] =>
  result.mutants.map((mutant) =>
    [
      mutant.fileName,
      mutant.id,
      mutant.mutatorName,
      mutant.location.start.line,
      mutant.location.start.column,
      mutant.replacement,
    ].join(' ')
  )

const Feature = makeFeature({ it, layer })

Feature('Choosing extra concurrency mutations by name')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A run that asks for a mutation the library does not have stops with a message naming it',
      Gherkin.Do.pipe(
        Given('a module ready to be instrumented')('source', () => Effect.succeed(MODULE_SOURCE)),
        When('a run asks for a concurrency mutation by a name the library does not offer')(
          'failure',
          ({ source }: { source: string }) =>
            instrument([{ name: 'probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
              optInMutations: [UNKNOWN_MUTATOR_NAME],
            }).pipe(Effect.flip),
        ),
        Then('the run fails, and the message names the entry it does not have')((
          { failure }: { failure: InstrumentError },
        ) =>
          Effect.sync(() => {
            expect(failure.message).toContain(UNKNOWN_MUTATOR_NAME)
          })
        ),
      ),
    )

    scenario(
      'A run that asks for no extra mutation asks for the same run as one that asks for an empty list',
      Gherkin.Do.pipe(
        Given('every Effect concurrency fixture has been read from disk')(
          'fixtures',
          () => Effect.promise(() => loadFixtureFiles()),
        ),
        When('the fixtures are instrumented with no list of extra mutations at all')(
          'unlisted',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(filesToInstrument(fixtures), { ignorers: [], excludedMutations: [] }),
        ),
        When('the fixtures are instrumented with an empty list of extra mutations')(
          'emptyList',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(filesToInstrument(fixtures), {
              ignorers: [],
              excludedMutations: [],
              optInMutations: [],
            }),
        ),
        Then('neither report holds a concurrency fault, and both hold the same ordinary mutants')((
          { unlisted, emptyList }: { unlisted: InstrumentResult; emptyList: InstrumentResult },
        ) =>
          Effect.sync(() => {
            expect(concurrencyMutantsIn(unlisted)).toStrictEqual([])
            expect(concurrencyMutantsIn(emptyList)).toStrictEqual([])
            expect(mutantLinesOf(unlisted).length).toBeGreaterThan(0)
            expect(mutantLinesOf(emptyList)).toStrictEqual(mutantLinesOf(unlisted))
          })
        ),
      ),
    )
  })
