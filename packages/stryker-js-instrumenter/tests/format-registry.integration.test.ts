import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  coreFormatRegistry,
  disableTypeChecks,
  formatRegistry,
  instrument,
  type InstrumentResult,
} from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import * as Exit from 'effect/Exit'
import { expect } from 'vitest'

const OPTIONS = { ignorers: [], excludedMutations: [] }

const COMPONENT = `<script>
  export let n = 1
  const big = n > 10
</script>
<p>{big}</p>
`

const BROKEN_COMPONENT = `<script>
  export let n =
</script>
`

const PAGE = `<script>const answer = 42</script>
<p>static</p>
`

const installedWithoutSvelte = formatRegistry(
  coreFormatRegistry.entries.filter((entry) => entry.claim.formatId !== 'svelte'),
)

const Feature = makeFeature({ it, layer })

Feature('Instrumenting files by the format that claims them')
  .body(({ scenario }) => {
    scenario(
      'A file no installed format claims is skipped and the run still completes',
      Gherkin.Do.pipe(
        Given('a component and an installation whose formats do not include it')(
          'project',
          () => Effect.succeed({ source: COMPONENT, registry: installedWithoutSvelte }),
        ),
        When('the project is instrumented')(
          'result',
          ({ project }: { project: { source: string; registry: typeof coreFormatRegistry } }) =>
            instrument(
              [{ name: '/tmp/component.svelte', content: project.source, mutate: true }],
              OPTIONS,
              project.registry,
            ),
        ),
        Then('the file is reported skipped with no output files and no mutants')((
          { result }: { result: InstrumentResult },
        ) =>
          Effect.sync(() => {
            expect(result.files).toStrictEqual([])
            expect(result.mutants).toStrictEqual([])
            expect(result.skipped).toHaveLength(1)
            expect(result.skipped[0]?.file).toBe('/tmp/component.svelte')
            expect(result.skipped[0]?.extension).toBe('.svelte')
            expect(result.skipped[0]?.reason.length).toBeGreaterThan(0)
          })
        ),
      ),
    )

    scenario(
      'A file whose format owns it but which cannot be parsed fails the run instead of being skipped',
      Gherkin.Do.pipe(
        Given('a component with a broken script block')(
          'source',
          () => Effect.succeed(BROKEN_COMPONENT),
        ),
        When('the project is instrumented')(
          'exit',
          ({ source }: { source: string }) =>
            Effect.exit(
              instrument([{ name: '/tmp/broken.svelte', content: source, mutate: true }], OPTIONS),
            ),
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
      'Disabling type checking inside a web page touches the script and leaves the markup alone',
      Gherkin.Do.pipe(
        Given('a page holding a script block and static markup')(
          'source',
          () => Effect.succeed(PAGE),
        ),
        When('type checking is disabled for the page')(
          'disabled',
          ({ source }: { source: string }) =>
            Effect.promise(() => disableTypeChecks({ name: '/tmp/page.html', content: source, mutate: true })),
        ),
        Then('the script is marked to skip type checking and the markup is unchanged')((
          { disabled }: { disabled: { content: string } },
        ) =>
          Effect.sync(() => {
            expect(disabled.content).toContain('// @ts-nocheck')
            expect(disabled.content).toContain('<p>static</p>')
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
