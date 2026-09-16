import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { disableTypeChecks, instrument, type InstrumentResult } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import * as Exit from 'effect/Exit'
import { expect } from 'vitest'

const OPTIONS = { ignorers: [], excludedMutations: [] }

const SCRIPT = `export const answer = 42
`

const BROKEN_SCRIPT = `export const answer =
`

const Feature = makeFeature({ it, layer })

Feature('Instrumenting files by the format that claims them')
  .body(({ scenario }) => {
    scenario(
      'A file no installed format claims is skipped and the run still completes',
      Gherkin.Do.pipe(
        Given('a file whose extension no installed format claims')(
          'source',
          () => Effect.succeed(SCRIPT),
        ),
        When('the project is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            instrument([{ name: '/tmp/notes.txt', content: source, mutate: true }], OPTIONS),
        ),
        Then('the file is reported skipped with no output files and no mutants')((
          { result }: { result: InstrumentResult },
        ) =>
          Effect.sync(() => {
            expect(result.files).toStrictEqual([])
            expect(result.mutants).toStrictEqual([])
            expect(result.skipped).toHaveLength(1)
            expect(result.skipped[0]?.file).toBe('/tmp/notes.txt')
            expect(result.skipped[0]?.extension).toBe('.txt')
            expect(result.skipped[0]?.reason.length).toBeGreaterThan(0)
          })
        ),
      ),
    )

    scenario(
      'A file whose format owns it but which cannot be parsed fails the run instead of being skipped',
      Gherkin.Do.pipe(
        Given('a script file with a syntax error')('source', () => Effect.succeed(BROKEN_SCRIPT)),
        When('the project is instrumented')(
          'exit',
          ({ source }: { source: string }) =>
            Effect.exit(instrument([{ name: '/tmp/broken.ts', content: source, mutate: true }], OPTIONS)),
        ),
        Then('the run fails rather than completing with a skip record')((
          { exit }: { exit: Exit.Exit<InstrumentResult, unknown> },
        ) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Disabling type checking on a script file exempts the file and leaves its content alone',
      Gherkin.Do.pipe(
        Given('a script file declaring an exported constant')('source', () => Effect.succeed(SCRIPT)),
        When('type checking is disabled for it')(
          'disabled',
          ({ source }: { source: string }) =>
            Effect.promise(() => disableTypeChecks({ name: '/tmp/page.ts', content: source, mutate: true })),
        ),
        Then('the file comes back exempted from type checking with its content unchanged')((
          { disabled, source }: { disabled: { content: string }; source: string },
        ) =>
          Effect.sync(() => {
            expect(disabled.content).toBe(`// @ts-nocheck\n${source}`)
          })
        ),
      ),
    )

    scenario(
      'A file no installed format owns is left alone when type checking is disabled',
      Gherkin.Do.pipe(
        Given('a plain text file')(
          'source',
          () => Effect.succeed('plain notes\n'),
        ),
        When('type checking is disabled for it')(
          'disabled',
          ({ source }: { source: string }) =>
            Effect.promise(() => disableTypeChecks({ name: '/tmp/notes.txt', content: source, mutate: true })),
        ),
        Then('its content comes back byte-identical')((
          { disabled, source }: { disabled: { content: string }; source: string },
        ) =>
          Effect.sync(() => {
            expect(disabled.content).toBe(source)
          })
        ),
      ),
    )
  })
