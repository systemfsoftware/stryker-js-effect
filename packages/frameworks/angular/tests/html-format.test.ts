import type {
  EmbeddedDocument,
  FormatId,
  Framework,
  FrameworkContext,
  FrameworkParseResult,
  Program,
  ScriptFormat,
} from '@systemfsoftware/stryker-framework-interface'
import parserManifest from 'angular-html-parser/package.json' with { type: 'json' }
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { strykerFrameworks } from '../src/mod.js'

const TWO_SCRIPT_HTML = [
  '<script>',
  'const a = 1 + 2',
  '</script>',
  '<p>text</p>',
  '<script lang="ts">',
  'const b = 3 + 4',
  '</script>',
  '',
].join('\n')

const FIRST_SCRIPT_BODY = '\nconst a = 1 + 2\n'
const SECOND_SCRIPT_BODY = '\nconst b = 3 + 4\n'

const TWO_SCRIPT_HTML_NO_CHECK = [
  '<script>// @ts-nocheck',
  '',
  'const a = 1 + 2',
  '</script>',
  '<p>text</p>',
  '<script lang="ts">// @ts-nocheck',
  '',
  'const b = 3 + 4',
  '</script>',
  '',
].join('\n')

const VUE_COMPONENT = [
  '<template>',
  '  <p>{{ count }}</p>',
  '</template>',
  '',
  '<script lang="ts">',
  'const count = 1 + 2',
  '</script>',
  '',
].join('\n')

const VUE_SCRIPT_BODY = '\nconst count = 1 + 2\n'

const UNCLOSED_SCRIPT_HTML = '<script>const a = 1 + 2'

const SINGLE_SCRIPT_HTML = '<script>const a = 1 + 2</script>\n'

const FILTERED_HTML = [
  '<script src="https://example.com/app.js"></script>',
  '<script type="application/json">',
  '{"a": 1}',
  '</script>',
  '',
].join('\n')

const TYPE_PRECEDENCE_HTML = '<script type="text/typescript" lang="js">const a: number = 1</script>\n'

const HASHBANG_HTML = '<script>#!/usr/bin/env node\nconst a = 1 + 2\n</script>\n'
const HASHBANG_HTML_NO_CHECK = '<script>#!/usr/bin/env node\n// @ts-nocheck\nconst a = 1 + 2\n</script>\n'

const HASHBANG_WITHOUT_NEWLINE_HTML = '<script>#!node</script>'

const LEADING_COMMENT_HTML = '<script>/* header */\nconst a = 1 + 2\n</script>\n'
const LEADING_COMMENT_HTML_NO_CHECK = '<script>/* header */\n// @ts-nocheck\n\nconst a = 1 + 2\n</script>\n'

const angular = (): Framework => {
  const [framework] = strykerFrameworks
  if (framework?.kind !== 'Framework') {
    throw new Error('@systemfsoftware/stryker-js-angular exports no Framework contribution')
  }
  return framework
}

const toolkit = (): FrameworkContext => {
  const sources = new WeakMap<object, string>()
  return {
    parseScript: (source, scriptFormat) => {
      const parsed = parseSync(`script.${scriptFormat}`, source, { lang: scriptFormat, range: true })
      sources.set(parsed.program, source)
      return parsed.program
    },
    transformScript: (script) => script,
    printScript: (script) => sources.get(script) ?? '',
    instrumentationHeader: () => [],
  }
}

const recordingToolkit = (): {
  context: FrameworkContext
  formats: ScriptFormat[]
  sources: string[]
} => {
  const formats: ScriptFormat[] = []
  const sources: string[] = []
  const inner = toolkit()
  const context: FrameworkContext = {
    ...inner,
    parseScript: (source, scriptFormat) => {
      formats.push(scriptFormat)
      sources.push(source)
      return inner.parseScript(source, scriptFormat)
    },
  }
  return { context, formats, sources }
}

const crashingToolkit = (thrown: unknown): FrameworkContext => {
  const inner = toolkit()
  const parseScript = (): Program => {
    throw thrown
  }
  return { ...inner, parseScript }
}

const parsedDocument = (content: string, context: FrameworkContext): EmbeddedDocument => {
  const result: FrameworkParseResult<EmbeddedDocument> = angular().parse(content, context)
  if (result.kind !== 'Parsed') {
    throw new Error(`the document did not parse: ${result.message}`)
  }
  return result.value
}

const failedParse = (content: string, context: FrameworkContext): string => {
  const result: FrameworkParseResult<EmbeddedDocument> = angular().parse(content, context)
  if (result.kind !== 'ParseFailed') {
    throw new Error('the document unexpectedly parsed')
  }
  return result.message
}

const typeCheckFree = (content: string): string => {
  const result: FrameworkParseResult<string> = angular().disableTypeChecks(content)
  if (result.kind !== 'Parsed') {
    throw new Error(`type-check disabling failed: ${result.message}`)
  }
  return result.value
}

const failedTypeCheckFree = (content: string): string => {
  const result: FrameworkParseResult<string> = angular().disableTypeChecks(content)
  if (result.kind !== 'ParseFailed') {
    throw new Error('type-check disabling unexpectedly succeeded')
  }
  return result.message
}

const firstRegion = (document: EmbeddedDocument) => {
  const region = document.regions.at(0)
  if (region === undefined) {
    throw new Error('the document gave up no script region')
  }
  return region
}

const documentWithRegion = (scriptAst: unknown): EmbeddedDocument => ({
  formatId: 'html' as FormatId,
  rawContent: SINGLE_SCRIPT_HTML,
  regions: [{ start: 8, end: 23, isExpression: false, scriptAst }],
})

const installedParserVersion = (): string => parserManifest.version

describe('the Angular framework plugin', () => {
  it('publishes one Framework contribution claiming the html template format', () => {
    expect(strykerFrameworks).toHaveLength(1)
    const framework = angular()
    expect(framework.kind).toBe('Framework')
    expect(framework.name).toBe('angular')
    expect(framework.claim).toStrictEqual({
      formatId: 'html',
      extensions: ['.html', '.htm', '.vue'],
      language: 'html',
      ownerVersion: installedParserVersion(),
      contractVersion: '1',
    })
  })

  it('yields one region per script with offsets into the original document', () => {
    const document = parsedDocument(TWO_SCRIPT_HTML, toolkit())
    expect(document.formatId).toBe('html')
    expect(document.rawContent).toBe(TWO_SCRIPT_HTML)
    expect(document.regions).toHaveLength(2)
    expect(document.regions.map((region) => document.rawContent.slice(region.start, region.end))).toStrictEqual([
      FIRST_SCRIPT_BODY,
      SECOND_SCRIPT_BODY,
    ])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([false, false])
  })

  it('yields only the script region of a Vue component, parsed as TypeScript', () => {
    const recorded = recordingToolkit()
    const document = parsedDocument(VUE_COMPONENT, recorded.context)
    expect(document.regions).toHaveLength(1)
    expect(document.rawContent.slice(firstRegion(document).start, firstRegion(document).end)).toBe(VUE_SCRIPT_BODY)
    expect(recorded.formats).toStrictEqual(['ts'])
    expect(recorded.sources).toStrictEqual([VUE_SCRIPT_BODY])
  })

  it('hands the transform through unchanged', () => {
    const context = toolkit()
    const document = parsedDocument(TWO_SCRIPT_HTML, context)
    expect(angular().transform(document, context)).toStrictEqual(document)
  })

  it('prints an untransformed document byte-for-byte', () => {
    const context = toolkit()
    const document = parsedDocument(TWO_SCRIPT_HTML, context)
    expect(angular().print(document, context)).toBe(TWO_SCRIPT_HTML)
  })

  it('starts each script region type-check free', () => {
    expect(typeCheckFree(TWO_SCRIPT_HTML)).toBe(TWO_SCRIPT_HTML_NO_CHECK)
  })

  it('keeps the @ts-nocheck comment after a leading hashbang', () => {
    expect(typeCheckFree(HASHBANG_HTML)).toBe(HASHBANG_HTML_NO_CHECK)
  })

  it('leaves a hashbang without a newline alone', () => {
    expect(typeCheckFree(HASHBANG_WITHOUT_NEWLINE_HTML)).toBe(HASHBANG_WITHOUT_NEWLINE_HTML)
  })

  it('keeps the @ts-nocheck comment after a leading block comment', () => {
    expect(typeCheckFree(LEADING_COMMENT_HTML)).toBe(LEADING_COMMENT_HTML_NO_CHECK)
  })

  it('refuses a script tag that never closes instead of passing it through', () => {
    expect(failedParse(UNCLOSED_SCRIPT_HTML, toolkit()).length).toBeGreaterThan(0)
  })

  it('refuses type-check disabling for a script tag that never closes', () => {
    expect(failedTypeCheckFree(UNCLOSED_SCRIPT_HTML).length).toBeGreaterThan(0)
  })

  it('ignores script tags with a src attribute and scripts with an unknown type', () => {
    const document = parsedDocument(FILTERED_HTML, toolkit())
    expect(document.regions).toHaveLength(0)
  })

  it('prefers the type attribute over the lang attribute for the script vocabulary', () => {
    const recorded = recordingToolkit()
    parsedDocument(TYPE_PRECEDENCE_HTML, recorded.context)
    expect(recorded.formats).toStrictEqual(['ts'])
  })

  it('contains a toolkit that crashes with an Error as a parse failure', () => {
    const message = failedParse(SINGLE_SCRIPT_HTML, crashingToolkit(new Error('the toolkit refused the script')))
    expect(message).toBe('the toolkit refused the script')
  })

  it('contains a toolkit that crashes with a non-Error as a parse failure', () => {
    const message = failedParse(SINGLE_SCRIPT_HTML, crashingToolkit('the toolkit exploded'))
    expect(message.length).toBeGreaterThan(0)
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['a plain object', {}],
  ])('refuses to print a region whose parsed program was replaced by %s', (_label, scriptAst) => {
    expect(() => angular().print(documentWithRegion(scriptAst), toolkit())).toThrow(
      'a script region reached print without its parsed program',
    )
  })
})
