import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Format, Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

import { failingFramework, fixtureDocument, fixtureFramework } from './__fixtures__/framework.js'
import { instrument } from './__fixtures__/instrument.js'

const OPTIONS = { ignorers: [], excludedMutations: [] }

const registryWith = (framework: typeof fixtureFramework) =>
  Format.registerEntries(Format.coreFormatRegistry, [Format.frameworkEntryOf('fixture-plugin', framework)])

const Feature = makeFeature({ it, layer })

Feature('Instrumenting files in formats a framework plugin teaches')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A document in a plugin format gets mutants only inside its script region',
      Gherkin.Do.pipe(
        Given('a mini document with one script region between text')('source', () => Effect.succeed(fixtureDocument)),
        When('it is instrumented with the mini plugin configured')(
          'result',
          ({ source }: { source: string }) =>
            instrument(
              [{ name: '/tmp/page.mini', content: source, mutate: true }],
              OPTIONS,
              registryWith(fixtureFramework),
            ),
        ),
        Then('the addition inside the region is mutated at its place in the document')((
          { result }: { result: Instrument.InstrumentResult },
        ) =>
          Effect.sync(() => {
            const oneBased = (index: number): number => index + 1
            const regionFirst = oneBased(fixtureDocument.indexOf('{{'))
            const regionLast = oneBased(fixtureDocument.indexOf('}}') + '}}'.length)
            const column = oneBased(fixtureDocument.indexOf('n + 1'))
            const arithmetic = result.mutants.filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
            expect(arithmetic.map((mutant) => [mutant.replacement, mutant.location])).toStrictEqual([
              ['n - 1', { start: { line: 1, column }, end: { line: 1, column: column + 'n + 1'.length } }],
            ])
            expect(result.mutants.every((mutant) =>
              mutant.location.start.column >= regionFirst && mutant.location.end.column <= regionLast
            )).toBe(true)
            expect(result.skipped).toStrictEqual([])
          })
        ),
      ),
    )

    scenario(
      'A file no format claims is skipped while the rest of the project is instrumented',
      Gherkin.Do.pipe(
        Given('a mini document beside a script file')('source', () => Effect.succeed(fixtureDocument)),
        When('they are instrumented without any plugin configured')(
          'result',
          ({ source }: { source: string }) =>
            instrument(
              [
                { name: '/tmp/page.mini', content: source, mutate: true },
                { name: '/tmp/add.js', content: 'export const add = (a, b) => a + b\n', mutate: true },
              ],
              OPTIONS,
              Format.coreFormatRegistry,
            ),
        ),
        Then('the mini document is reported as skipped and the script file still gets mutants')((
          { result }: { result: Instrument.InstrumentResult },
        ) =>
          Effect.sync(() => {
            expect(result.skipped.map((skip) => [skip.file, skip.extension])).toStrictEqual([[
              '/tmp/page.mini',
              '.mini',
            ]])
            expect(result.mutants.map((mutant) => mutant.fileName)).toContain('/tmp/add.js')
            expect(result.mutants.map((mutant) => mutant.fileName)).not.toContain('/tmp/page.mini')
          })
        ),
      ),
    )

    scenario(
      'A document the plugin cannot parse stops instrumentation with the plugin message',
      Gherkin.Do.pipe(
        Given('a mini document')('source', () => Effect.succeed(fixtureDocument)),
        When('it is instrumented with a plugin that refuses the document')(
          'error',
          ({ source }: { source: string }) =>
            instrument(
              [{ name: '/tmp/page.mini', content: source, mutate: true }],
              OPTIONS,
              registryWith(failingFramework),
            ).pipe(Effect.flip),
        ),
        Then('instrumentation fails naming the file and the plugin reason')(({ error }: {
          error: Instrument.InstrumentError
        }) =>
          Effect.sync(() => {
            expect(error.message).toContain('/tmp/page.mini')
            expect(error.message).toContain('fixture refuses this document')
          })
        ),
      ),
    )

    scenario(
      'Switching off type checks marks the plugin document and leaves an unclaimed file untouched',
      Gherkin.Do.pipe(
        Given('a mini document and a file in an unknown format')(
          'sources',
          () => Effect.succeed({ mini: fixtureDocument, unknown: 'n + 1' }),
        ),
        When('type checks are switched off with the mini plugin configured')(
          'files',
          ({ sources }: { sources: { mini: string; unknown: string } }) =>
            Effect.all([
              Instrument.disableTypeChecks(
                { name: '/tmp/page.mini', content: sources.mini, mutate: true },
                registryWith(fixtureFramework),
              ),
              Instrument.disableTypeChecks(
                { name: '/tmp/notes.unknown', content: sources.unknown, mutate: true },
                registryWith(fixtureFramework),
              ),
            ]),
        ),
        Then('the mini document carries the marker before its region and the unknown file is unchanged')((
          { files }: { files: readonly Instrument.File[] },
        ) =>
          Effect.sync(() => {
            expect(files.map((file) => file.content)).toStrictEqual([
              'before // @ts-nocheck\n{{ n + 1 }} after',
              'n + 1',
            ])
          })
        ),
      ),
    )
  })
