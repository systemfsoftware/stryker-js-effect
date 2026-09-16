import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { FrameworkContext, Program, ScriptFormat } from '@systemfsoftware/stryker-framework-interface'
import { strykerIgnorers, strykerPlugins } from '@systemfsoftware/stryker-js-angular'
import type { FrameworkService } from '@systemfsoftware/stryker-js-language'
import type { EmbeddedDocument, FrameworkClaim } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

import { angularService, installedEnvironmentLayer, installedParserVersion } from './__fixtures__/angular-plugin.js'

const VUE_COMPONENT = `<template>
  <p>{{ count }}</p>
</template>

<script lang="ts">
const count = 1 + 2
</script>
`

const VUE_SCRIPT_BODY = '\nconst count = 1 + 2\n'

const TWO_SCRIPT_HTML = `<script>
const a = 1 + 2
</script>
<p>text</p>
<script lang="ts">
const b = 3 + 4
</script>
`

const FIRST_SCRIPT_BODY = '\nconst a = 1 + 2\n'
const SECOND_SCRIPT_BODY = '\nconst b = 3 + 4\n'

const PRINTED_TWO_SCRIPT_HTML = `<script>
[[0]]
</script>
<p>text</p>
<script lang="ts">
[[1]]
</script>
`

const TYPE_CHECK_FREE_TWO_SCRIPT_HTML = `<script>
// @ts-nocheck

const a = 1 + 2

</script>
<p>text</p>
<script lang="ts">
// @ts-nocheck

const b = 3 + 4

</script>
`

const UNCLOSED_SCRIPT_HTML = '<script>const a = 1 + 2'

const expectedClaim = (ownerVersion: string): FrameworkClaim => ({
  formatId: 'html',
  extensions: ['.html', '.htm', '.vue'],
  language: 'html',
  ownerVersion,
  contractVersion: '1',
})

const preparedService = () =>
  Effect.gen(function*() {
    const environment = yield* installedEnvironmentLayer
    return yield* angularService(environment)
  })

interface ParsedScript {
  readonly source: string
  readonly scriptFormat: ScriptFormat
  readonly program: Program
}

interface ClaimState {
  readonly document: EmbeddedDocument
  readonly recorded: readonly ParsedScript[]
}

interface PrintState {
  readonly document: EmbeddedDocument
  readonly printed: string
}

interface Publication {
  readonly plugins: typeof strykerPlugins
  readonly claim: FrameworkClaim
  readonly rules: readonly string[]
  readonly installedOwnerVersion: string
}

interface DeclaredContribution {
  readonly kind: string
  readonly name: string
  readonly claim: FrameworkClaim
  readonly rules: readonly string[]
  readonly installedOwnerVersion: string
}

const recordingToolkit = (): { readonly toolkit: FrameworkContext; readonly recorded: ParsedScript[] } => {
  const recorded: ParsedScript[] = []
  return {
    recorded,
    toolkit: {
      parseScript: (source, scriptFormat) => {
        const program: Program = { type: 'Program', sourceType: 'module', body: [], hashbang: null }
        recorded.push({ source, scriptFormat, program })
        return program
      },
      transformScript: (script) => script,
      printScript: (script) => `[[${recorded.findIndex((parsed) => parsed.program === script)}]]`,
      instrumentationHeader: () => [],
    },
  }
}

const Feature = makeFeature({ it, layer })

Feature('Instrumenting the scripts embedded in HTML templates').body(({ scenario }) => {
  scenario(
    'A Vue single-file component gives up only its script region',
    Gherkin.Do.pipe(
      Given('the Angular plugin prepared with the parser resolved from the install')('service', preparedService),
      Given('a Vue component holding a template expression beside a TypeScript script')(
        'content',
        () => Effect.succeed(VUE_COMPONENT),
      ),
      When('the plugin parses the component')(
        'claim',
        ({ content, service }: { content: string; service: FrameworkService }) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit()
            const document = yield* service.parse(content, recorder.toolkit)
            return { document, recorded: recorder.recorded }
          }),
      ),
      Then('only the script is claimed, and it reaches the toolkit as TypeScript')(
        ({ claim }: { claim: ClaimState }) => {
          expect(claim.recorded.map((script) => script.scriptFormat)).toStrictEqual(['ts'])
          expect(claim.recorded.map((script) => script.source)).toStrictEqual([VUE_SCRIPT_BODY])
          const region = claim.document.regions.at(0)
          if (region === undefined) {
            throw new Error('the Vue component gave up no script region')
          }
          expect(region.isExpression).toBe(false)
          expect(claim.document.rawContent.slice(region.start, region.end)).toBe(VUE_SCRIPT_BODY)
        },
      ),
    ),
  )

  scenario(
    'Every script in an HTML document prints back between its own tags',
    Gherkin.Do.pipe(
      Given('the Angular plugin prepared with the parser resolved from the install')('service', preparedService),
      Given('an HTML document holding two scripts around ordinary markup')(
        'content',
        () => Effect.succeed(TWO_SCRIPT_HTML),
      ),
      When('the plugin parses the document and prints it back')(
        'print',
        ({ content, service }: { content: string; service: FrameworkService }) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit()
            const document = yield* service.parse(content, recorder.toolkit)
            const printed = yield* service.print(document, recorder.toolkit)
            return { document, printed }
          }),
      ),
      Then('each script sits where it started, over markup that did not move')((
        { print }: { print: PrintState },
      ) => {
        expect(print.printed).toBe(PRINTED_TWO_SCRIPT_HTML)
        expect(print.document.regions.map((region) => print.document.rawContent.slice(region.start, region.end)))
          .toStrictEqual([FIRST_SCRIPT_BODY, SECOND_SCRIPT_BODY])
      }),
    ),
  )

  scenario(
    'Every script region is marked as type-check free',
    Gherkin.Do.pipe(
      Given('the Angular plugin prepared with the parser resolved from the install')('service', preparedService),
      Given('an HTML document holding two scripts around ordinary markup')(
        'content',
        () => Effect.succeed(TWO_SCRIPT_HTML),
      ),
      When('the plugin disables type checking for the document')(
        'disabled',
        ({ content, service }: { content: string; service: FrameworkService }) => service.disableTypeChecks(content),
      ),
      Then('each script starts type-check free, over markup that did not move')((
        { disabled }: { disabled: string },
      ) => {
        expect(disabled).toBe(TYPE_CHECK_FREE_TWO_SCRIPT_HTML)
      }),
    ),
  )

  scenario(
    'A script tag that never closes is refused',
    Gherkin.Do.pipe(
      Given('the Angular plugin prepared with the parser resolved from the install')('service', preparedService),
      Given('an HTML document whose script tag is never closed')(
        'content',
        () => Effect.succeed(UNCLOSED_SCRIPT_HTML),
      ),
      When('the plugin parses the document')(
        'outcome',
        ({ content, service }: { content: string; service: FrameworkService }) =>
          service.parse(content, recordingToolkit().toolkit).pipe(
            Effect.match({
              onFailure: (failure) => ({ refused: true, reason: failure.reason }),
              onSuccess: () => ({ refused: false, reason: '' }),
            }),
          ),
      ),
      Then('the document is refused instead of quietly passing through')((
        { outcome }: { outcome: { refused: boolean; reason: string } },
      ) => {
        expect(outcome.refused).toBe(true)
        expect(outcome.reason.length).toBeGreaterThan(0)
      }),
    ),
  )

  scenario(
    'The plugin declares the HTML format beside its signal rule',
    Gherkin.Do.pipe(
      Given('the Angular plugin prepared with the parser resolved from the install')('service', preparedService),
      Given('the plugin and the ignore rule the package publishes')(
        'published',
        ({ service }: { service: FrameworkService }) =>
          Effect.gen(function*() {
            return {
              plugins: strykerPlugins,
              claim: service.claim,
              rules: strykerIgnorers.map((ignorer) => ignorer.name),
              installedOwnerVersion: yield* installedParserVersion,
            }
          }),
      ),
      When('the contributions are read')(
        'contributions',
        ({ published }: { published: Publication }) => {
          const plugin = published.plugins.at(0)
          if (plugin === undefined) {
            return Effect.die(new Error('the package publishes no plugin contribution'))
          }
          return Effect.succeed({
            kind: plugin.kind,
            name: plugin.name,
            claim: published.claim,
            rules: published.rules,
            installedOwnerVersion: published.installedOwnerVersion,
          })
        },
      ),
      Then('the format claims the HTML template extensions and the signal rule rides beside it')((
        { contributions }: { contributions: DeclaredContribution },
      ) => {
        expect(contributions.kind).toBe('Framework')
        expect(contributions.name).toBe('angular')
        expect(contributions.claim).toStrictEqual(expectedClaim(contributions.installedOwnerVersion))
        expect(contributions.rules).toStrictEqual(['angular-signal-io'])
      }),
    ),
  )
})
