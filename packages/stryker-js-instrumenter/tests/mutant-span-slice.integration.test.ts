import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type {
  EmbeddedDocument,
  Framework,
  FrameworkContext,
  FrameworkParseResult,
} from '@systemfsoftware/stryker-framework-interface'
import {
  coreFormatRegistry,
  frameworkEntryOf,
  type InstrumentResult,
  type Location,
  registerEntries,
} from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

import { instrument } from './__fixtures__/instrument.js'

const Feature = makeFeature({ it, layer })

const MATH_SOURCE = 'export const incrementBy = (value: number, step: number): number => value + step\n' +
  '\nexport const toggleValue = (value: boolean): boolean => !value\n'

const SOURCES: Record<string, string> = { '/tmp/math.ts': MATH_SOURCE }

const sourceOf = (fileName: string): string => {
  const found = SOURCES[fileName]
  if (found === undefined) {
    throw new Error(`no source registered for ${fileName}`)
  }
  return found
}

const lineOf = (content: string, line: number): string => {
  const found = content.split('\n')[line - 1]
  if (found === undefined) {
    throw new Error(`the source has no line ${line}`)
  }
  return found
}

const slicedText = (content: string, location: Location): string =>
  lineOf(content, location.start.line).slice(location.start.column - 1, location.end.column - 1)

interface LocatedMutant {
  readonly mutatorName: string
  readonly replacement: string
  readonly location: Location
}

const locatedOf = (result: InstrumentResult): readonly LocatedMutant[] =>
  result.mutants.map((mutant) => ({
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    location: mutant.location,
  }))

const textsOf = (fileName: string, mutants: readonly LocatedMutant[]): readonly string[] =>
  mutants.map((mutant) => slicedText(sourceOf(fileName), mutant.location))

const parsed = <A>(value: A): FrameworkParseResult<A> => ({ kind: 'Parsed', value })

const pendingContext: { readonly current: { context: FrameworkContext | undefined } } = {
  current: { context: undefined },
}

const activeContext = (holder: { readonly context: FrameworkContext | undefined }): FrameworkContext => {
  if (holder.context === undefined) {
    throw new Error('the region plugin ran before any document was parsed')
  }
  return holder.context
}

const regionDocument = (rawContent: string, spans: ReadonlyArray<readonly [number, number]>): EmbeddedDocument => ({
  formatId: 'span-fixture',
  rawContent,
  regions: spans.map(([start, end]) => ({
    start,
    end,
    isExpression: false,
    scriptAst: activeContext(pendingContext.current).parseScript(rawContent.slice(start, end), 'js'),
  })),
})

const spanFixture = (spansOfDocument: (rawContent: string) => ReadonlyArray<readonly [number, number]>): Framework => ({
  kind: 'Framework',
  name: 'span-fixture',
  claim: {
    formatId: 'span-fixture',
    extensions: ['.span'],
    language: 'span',
    ownerVersion: '0.0.0-test',
    contractVersion: '1',
  },
  parse: (rawContent, context) => {
    pendingContext.current.context = context
    return parsed(regionDocument(rawContent, spansOfDocument(rawContent)))
  },
  transform: (document) => document,
  print: (document) => document.rawContent,
  disableTypeChecks: (rawContent) => parsed(rawContent),
})

const scriptTagSpans = (rawContent: string): ReadonlyArray<readonly [number, number]> => {
  const open = rawContent.indexOf('<script>')
  const close = rawContent.indexOf('</script>')
  return [[open + '<script>'.length, close] as const]
}

const twoLineSpans = (rawContent: string): ReadonlyArray<readonly [number, number]> => {
  const first = rawContent.indexOf('{{')
  const second = rawContent.indexOf('[[', first)
  return [
    [first, rawContent.indexOf('}}', first) + '}}'.length] as const,
    [second, rawContent.indexOf(']]', second) + ']]'.length] as const,
  ]
}

const instrumentWith = (framework: Framework, name: string, content: string) =>
  instrument(
    [{ name, content, mutate: true }],
    { ignorers: [], excludedMutations: [] },
    registerEntries(
      coreFormatRegistry,
      [frameworkEntryOf('span-fixture-plugin', framework)],
    ),
  )

Feature('Mutants point at the text they change')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A small module reports spans that slice exactly the changed expressions',
      Gherkin.Do.pipe(
        Given('a small module with two exported functions')('source', () => Effect.succeed(MATH_SOURCE)),
        When('the module is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            instrument([{ name: '/tmp/math.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('every reported span slices exactly the changed text')((s) =>
          Effect.sync(() => {
            const located = locatedOf(s.result)
            expect(located.length).toBeGreaterThan(0)
            expect(located).toContainEqual({
              mutatorName: 'ArrowFunction',
              replacement: '() => undefined',
              location: { start: { line: 1, column: 28 }, end: { line: 1, column: 81 } },
            })
            expect(located).toContainEqual({
              mutatorName: 'ArithmeticOperator',
              replacement: 'value - step',
              location: { start: { line: 1, column: 69 }, end: { line: 1, column: 81 } },
            })
            expect(located).toContainEqual({
              mutatorName: 'BooleanLiteral',
              replacement: 'value',
              location: { start: { line: 3, column: 57 }, end: { line: 3, column: 63 } },
            })
            expect(textsOf('/tmp/math.ts', located)).toContain('(value: number, step: number): number => value + step')
            expect(textsOf('/tmp/math.ts', located)).toContain('value + step')
            expect(textsOf('/tmp/math.ts', located)).toContain('!value')
          })
        ),
      ),
    )

    scenario(
      'A script region inside markup reports spans that slice the region text',
      Gherkin.Do.pipe(
        Given('a markup document with a script region on its second line')(
          'document',
          () => Effect.succeed('<div>x</div>\n<script>\nconst x = 1 + 2\n</script>\n'),
        ),
        When('the document is instrumented through the region plugin')(
          'result',
          (s) => instrumentWith(spanFixture(scriptTagSpans), '/tmp/page.span', s.document),
        ),
        Then('the reported span slices the addition inside the region')((s) =>
          Effect.sync(() => {
            const arithmetic = locatedOf(s.result).filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
            expect(arithmetic.map((mutant) => mutant.location)).toStrictEqual([
              { start: { line: 3, column: 11 }, end: { line: 3, column: 16 } },
            ])
            const first = arithmetic.at(0)
            if (first !== undefined) {
              expect(slicedText(s.document, first.location)).toBe('1 + 2')
            } else {
              expect.unreachable('the region addition produced no arithmetic mutant')
            }
          })
        ),
      ),
    )

    scenario(
      'Regions on later lines shift lines without carrying the first-line column',
      Gherkin.Do.pipe(
        Given('a document with an expression region on each of two lines')(
          'document',
          () => Effect.succeed('before {{ n + 1 }} after\nsecond [[ m + 2 ]] end\n'),
        ),
        When('the document is instrumented through the region plugin')(
          'result',
          (s) => instrumentWith(spanFixture(twoLineSpans), '/tmp/two.span', s.document),
        ),
        Then('each reported span slices its own region text on its own line')((s) =>
          Effect.sync(() => {
            const arithmetic = locatedOf(s.result).filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
            expect(arithmetic.map((mutant) => mutant.location)).toStrictEqual([
              { start: { line: 1, column: 11 }, end: { line: 1, column: 16 } },
              { start: { line: 2, column: 11 }, end: { line: 2, column: 16 } },
            ])
            expect(arithmetic.map((mutant) => slicedText(s.document, mutant.location))).toStrictEqual([
              'n + 1',
              'm + 2',
            ])
          })
        ),
      ),
    )
  })
