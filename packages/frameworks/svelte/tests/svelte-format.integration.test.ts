import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Program, ScriptFormat, ScriptRegion, Statement } from '@systemfsoftware/stryker-framework-interface'
import type { EmbeddedDocument, FrameworkContext } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as Predicate from 'effect/Predicate'
import { VERSION as SVELTE_COMPILER_VERSION } from 'svelte/compiler'
import { expect } from 'vitest'

import { installedEnvironmentLayer, svelteService } from './__fixtures__/svelte-plugin.js'

const COMPONENT = `<script>
  export let n = 1
  const big = n > 10
</script>
<p>{big}</p>
`

const MODULE_COMPONENT = `<script context="module">
  export const shared = 1
</script>
<script>
  export let n = 1
</script>
`

const MODULE_HEADER_OPEN = '<script context="module">'

const HEADER: readonly Statement[] = [
  { type: 'ExpressionStatement', expression: { type: 'Identifier', name: 'stryMutAct' }, start: 0, end: 10 },
  { type: 'ExpressionStatement', expression: { type: 'Identifier', name: 'stryCov' }, start: 11, end: 20 },
]

interface RecordedScript {
  readonly source: string
  readonly scriptFormat: ScriptFormat
  readonly program: Program
}

interface ToolkitState {
  readonly toolkit: FrameworkContext
  readonly recorded: RecordedScript[]
}

const preparedSvelteService = () =>
  Effect.gen(function*() {
    const environment = yield* installedEnvironmentLayer
    return yield* svelteService(environment)
  })

const recordingToolkit = (header: readonly Statement[]): ToolkitState => {
  const recorded: RecordedScript[] = []
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
      instrumentationHeader: () => header,
    },
  }
}

const isProgram = (value: unknown): value is Program =>
  Predicate.isObject(value) && Array.isArray(Reflect.get(value, 'body'))

const programOf = (region: ScriptRegion | undefined): Program | undefined => {
  const ast: unknown = region?.scriptAst
  if (!isProgram(ast)) {
    return undefined
  }
  return ast
}

const placedHeaderIn = (document: EmbeddedDocument, index: number): void => {
  const program = programOf(document.regions.at(index))
  if (program !== undefined) {
    program.body.unshift(...HEADER.map((statement) => structuredClone(statement)))
  }
}

const trimmedSourcesOf = (recorded: readonly RecordedScript[]): readonly string[] =>
  recorded.map((script) => script.source.trim())

const formatsOf = (recorded: readonly RecordedScript[]): readonly ScriptFormat[] =>
  recorded.map((script) => script.scriptFormat)

const expressionFlagsOf = (document: EmbeddedDocument): readonly boolean[] =>
  document.regions.map((region) => region.isExpression)

const bodyLengthsOf = (document: EmbeddedDocument): readonly number[] =>
  document.regions.map((region) => programOf(region)?.body.length ?? 0)

const occurrencesOf = (text: string, needle: string): number => text.split(needle).length - 1

const Feature = makeFeature({ it, layer })

Feature('Instrumenting the script regions of a Svelte component').body(({ scenario }) => {
  scenario(
    'A Svelte component gives up its instance script and its template expression',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('a component holding a comparison and a template expression is read')(
        'read',
        (s) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit([])
            const document = yield* s.service.parse(COMPONENT, recorder.toolkit)
            return { document, recorded: recorder.recorded }
          }),
      ),
      Then('the instance script and the template expression are handed over as the text they are')(({ read }) => {
        expect(trimmedSourcesOf(read.recorded)).toStrictEqual([
          'export let n = 1\n  const big = n > 10',
          'big',
        ])
        expect(formatsOf(read.recorded)).toStrictEqual(['js', 'js'])
        expect(expressionFlagsOf(read.document)).toStrictEqual([false, true])
      }),
    ),
  )

  scenario(
    'Every script region prints back between its own boundaries',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('a component holding a comparison and a template expression is read and printed back')(
        'printed',
        (s) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit([])
            const document = yield* s.service.parse(COMPONENT, recorder.toolkit)
            return { document, printed: yield* s.service.print(document, recorder.toolkit) }
          }),
      ),
      Then('the script keeps its boundaries and the expression loses the statement terminator')(({ printed }) => {
        expect(printed.printed).toContain('\n[[0]]\n')
        expect(printed.printed).toContain('[[1]')
        expect(printed.printed).not.toContain('[[1]]')
      }),
    ),
  )

  scenario(
    'No module header is added while no mutant lands in the component',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('a component is read and prepared without any mutant landing in it')(
        'prepared',
        (s) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit([])
            const document = yield* s.service.parse(COMPONENT, recorder.toolkit)
            const prepared = yield* s.service.transform(document, recorder.toolkit)
            return { rawContent: prepared.rawContent, bodies: bodyLengthsOf(prepared) }
          }),
      ),
      Then('the component is left exactly as it was read')(({ prepared }) => {
        expect(prepared.bodies).toStrictEqual([0, 0])
        expect(prepared.rawContent).toBe(COMPONENT)
      }),
    ),
  )

  scenario(
    'The module header moves into a module script once a mutant lands in the component',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('a component without a module script is read and prepared with the header placed in it')(
        'prepared',
        (s) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit(HEADER)
            const read = yield* s.service.parse(COMPONENT, recorder.toolkit)
            placedHeaderIn(read, 0)
            placedHeaderIn(read, 1)
            const prepared = yield* s.service.transform(read, recorder.toolkit)
            return { rawContent: prepared.rawContent, bodies: bodyLengthsOf(prepared) }
          }),
      ),
      Then('one module script opens the component and no region keeps a private copy of the header')((
        { prepared },
      ) => {
        expect(prepared.bodies).toStrictEqual([HEADER.length, 0, 0])
        expect(prepared.rawContent.startsWith(MODULE_HEADER_OPEN)).toBe(true)
      }),
    ),
  )

  scenario(
    'A component that already declares a module script keeps the header inside it',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('a component declaring a module script is read and prepared with the header placed in it')(
        'prepared',
        (s) =>
          Effect.gen(function*() {
            const recorder = recordingToolkit(HEADER)
            const read = yield* s.service.parse(MODULE_COMPONENT, recorder.toolkit)
            placedHeaderIn(read, 0)
            const prepared = yield* s.service.transform(read, recorder.toolkit)
            return { rawContent: prepared.rawContent, bodies: bodyLengthsOf(prepared) }
          }),
      ),
      Then('the declared module script carries the header and no second one is added')(({ prepared }) => {
        expect(prepared.bodies).toStrictEqual([HEADER.length, 0])
        expect(prepared.rawContent).toBe(MODULE_COMPONENT)
      }),
    ),
  )

  scenario(
    'Every script region is marked as type-check free',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('type checking is disabled for a component holding a script and a template expression')(
        'disabled',
        (s) => s.service.disableTypeChecks(COMPONENT),
      ),
      Then('each region starts type-check free over the component it came from')(({ disabled }) => {
        expect(occurrencesOf(disabled, '// @ts-nocheck')).toBe(2)
        expect(disabled).toContain('export let n = 1')
        expect(disabled).toContain('</script>')
      }),
    ),
  )

  scenario(
    'The plugin declares the svelte format for the .svelte extension',
    Gherkin.Do.pipe(
      Given('the Svelte plugin prepared with the compiler resolved from the install')(
        'service',
        preparedSvelteService,
      ),
      When('the format the plugin claims is read')('claimed', (s) => Effect.succeed(s.service.claim)),
      Then('the claim names the svelte format, its extension, and the compiler version it resolved')(({ claimed }) => {
        expect(claimed).toStrictEqual({
          formatId: 'svelte',
          extensions: ['.svelte'],
          language: 'svelte',
          ownerVersion: SVELTE_COMPILER_VERSION,
          contractVersion: '1',
        })
      }),
    ),
  )
})
