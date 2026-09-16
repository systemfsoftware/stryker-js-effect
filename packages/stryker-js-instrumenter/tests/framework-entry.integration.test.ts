import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Program } from '@systemfsoftware/stryker-ignorer-interface'
import {
  coreFormatRegistry,
  type FormatRegistry,
  frameworkEntryOf,
  instrument,
  type InstrumentResult,
  registerEntries,
} from '@systemfsoftware/stryker-js-instrumenter'
import type { FrameworkService } from '@systemfsoftware/stryker-js-language'
import { Effect, Option } from 'effect'
import { expect } from 'vitest'

const OPTIONS = { ignorers: [], excludedMutations: [] }

const SCRIPT_OPEN = '<script>'
const SCRIPT_CLOSE = '</script>'

const SOURCE = `${SCRIPT_OPEN}\nconst answer = 1 + 2\n${SCRIPT_CLOSE}\n`

const MUTANT_ACTIVATION_MARKER = 'stryMutAct_9fa48'

const frameScript = (
  document: string,
  context: { printScript: (script: Program) => string },
  program: Program,
): string => {
  const start = document.indexOf(SCRIPT_OPEN) + SCRIPT_OPEN.length
  const end = document.indexOf(SCRIPT_CLOSE)
  return `${document.slice(0, start)}${context.printScript(program)}${document.slice(end)}`
}

const fakeService = (): FrameworkService => {
  let parsedProgram: Program | undefined
  return {
    claim: { formatId: 'dummy', extensions: ['.dummy'], language: 'dummy', ownerVersion: '1', contractVersion: '1' },
    parse: (rawContent, context) =>
      Effect.sync(() => {
        const start = rawContent.indexOf(SCRIPT_OPEN) + SCRIPT_OPEN.length
        const end = rawContent.indexOf(SCRIPT_CLOSE)
        const program = context.parseScript(rawContent.slice(start, end), 'ts')
        parsedProgram = program
        return {
          formatId: 'dummy',
          rawContent,
          regions: [{ start, end, isExpression: false, scriptAst: program }],
        }
      }),
    transform: (document) => Effect.succeed(document),
    print: (document, context) =>
      Effect.sync(() =>
        parsedProgram === undefined ? document.rawContent : frameScript(document.rawContent, context, parsedProgram)
      ),
    disableTypeChecks: (content) => Effect.succeed(content),
  }
}

const dummyRegistry = (): FormatRegistry =>
  registerEntries(coreFormatRegistry, [frameworkEntryOf('fixture', fakeService())])

interface ParsedSummary {
  readonly formatId: string
  readonly regionCount: number
  readonly scriptCount: number
}

const describeParsed = async (registry: FormatRegistry): Promise<ParsedSummary> => {
  const entry = Option.getOrThrow(registry.entryForFormat('dummy'))
  const ast = await entry.parse(SOURCE, '/tmp/component.dummy', {
    parse: () => Promise.reject(new Error('the framework adapter parses through its own toolkit')),
  })
  if (ast.format !== 'embedded') {
    throw new Error(`expected the embedded format, received "${ast.format}"`)
  }
  return { formatId: ast.formatId, regionCount: ast.document.regions.length, scriptCount: ast.scripts.length }
}

const Feature = makeFeature({ it, layer })

Feature('Folding a framework contribution into the format registry')
  .body(({ scenario }) => {
    scenario(
      'A framework format parses a document into its script regions',
      Gherkin.Do.pipe(
        Given('a registry holding a framework format that claims the dummy extension')(
          'registry',
          () => Effect.sync(dummyRegistry),
        ),
        When('the format parses a document holding one script region')(
          'parsed',
          (s: { registry: FormatRegistry }) => Effect.promise(() => describeParsed(s.registry)),
        ),
        Then('the parse reports the claimed format with the region and the script it carries')((s: {
          parsed: ParsedSummary
        }) => {
          expect(s.parsed.formatId).toBe('dummy')
          expect(s.parsed.regionCount).toBe(1)
          expect(s.parsed.scriptCount).toBe(1)
        }),
      ),
    )

    scenario(
      'A file owned by a framework format is instrumented and printed back into its document',
      Gherkin.Do.pipe(
        Given('a registry holding a framework format that claims the dummy extension')(
          'registry',
          () => Effect.sync(dummyRegistry),
        ),
        When('a dummy document is instrumented')(
          'result',
          (s: { registry: FormatRegistry }) =>
            instrument([{ name: '/tmp/component.dummy', content: SOURCE, mutate: true }], OPTIONS, s.registry),
        ),
        Then('mutants land inside the script and the surrounding document is preserved')((s: {
          result: InstrumentResult
        }) => {
          expect(s.result.skipped).toStrictEqual([])
          expect(s.result.mutants.length).toBeGreaterThan(0)
          const content = s.result.files[0]?.content ?? ''
          expect(content).toContain(SCRIPT_OPEN)
          expect(content).toContain(SCRIPT_CLOSE)
          expect(content).toContain(MUTANT_ACTIVATION_MARKER)
          expect(content).not.toBe(SOURCE)
        }),
      ),
    )
  })
