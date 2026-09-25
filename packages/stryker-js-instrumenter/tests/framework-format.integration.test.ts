import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Format, Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'

import { failingFramework, fixtureDocument, fixtureFramework } from './__fixtures__/framework.js'
import { instrument } from './__fixtures__/instrument.js'

const OPTIONS = { ignorers: [], excludedMutations: [] }

const registryWith = (framework: typeof fixtureFramework) =>
  Format.registerEntries(Format.coreFormatRegistry, [Format.frameworkEntryOf('fixture-plugin', framework)])

const Feature = makeFeature({ it })

Feature('Instrumenting files in formats a framework plugin teaches')
  .live('parses real source with the oxc parser loaded at run time')
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
          expect,
        ) => {
          const oneBased = (index: number): number => index + 1
          const regionFirst = oneBased(fixtureDocument.indexOf('{{'))
          const regionLast = oneBased(fixtureDocument.indexOf('}}') + '}}'.length)
          const column = oneBased(fixtureDocument.indexOf('n + 1'))
          const arithmetic = result.mutants.filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
          return expect({
            arithmetic: arithmetic.map((mutant) => [mutant.replacement, mutant.location]),
            everyMutantInsideRegion: result.mutants.every((mutant) =>
              mutant.location.start.column >= regionFirst && mutant.location.end.column <= regionLast
            ),
            skipped: result.skipped,
          }).toEqual({
            arithmetic: [['n - 1', { start: { line: 1, column }, end: { line: 1, column: column + 'n + 1'.length } }]],
            everyMutantInsideRegion: true,
            skipped: [],
          })
        }),
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
          expect,
        ) =>
          expect({
            skipped: result.skipped.map((skip) => [skip.file, skip.extension]),
            hasAdd: result.mutants.some((mutant) => mutant.fileName === '/tmp/add.js'),
            hasMini: result.mutants.some((mutant) => mutant.fileName === '/tmp/page.mini'),
          }).toEqual({ skipped: [['/tmp/page.mini', '.mini']], hasAdd: true, hasMini: false })
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
        }, expect) =>
          expect({
            namesFile: error.message.includes('/tmp/page.mini'),
            namesReason: error.message.includes('fixture refuses this document'),
          }).toEqual({ namesFile: true, namesReason: true })
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
          expect,
        ) =>
          expect(files.map((file) => file.content)).toEqual([
            'before // @ts-nocheck\n{{ n + 1 }} after',
            'n + 1',
          ])
        ),
      ),
    )
  })
