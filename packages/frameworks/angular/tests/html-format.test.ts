import type {
  EmbeddedDocument,
  Framework,
  FrameworkContext,
  FrameworkParseResult,
  Program,
  ScriptFormat,
} from '@systemfsoftware/stryker-framework-interface'
import { describe, it } from '@systemfsoftware/vitest'
import { parseSync } from 'oxc-parser'

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

const slicesOf = (document: EmbeddedDocument): readonly string[] =>
  document.regions.map((region) => document.rawContent.slice(region.start, region.end))

const installedParserVersion = '10.12.0'

describe('the Angular framework plugin', () => {
  it('publishes one Framework contribution claiming the html template format', function*({ expect }) {
    const framework = angular()
    yield* expect({
      count: strykerFrameworks.length,
      kind: framework.kind,
      name: framework.name,
      claim: framework.claim,
    }).toEqual({
      count: 1,
      kind: 'Framework',
      name: 'angular',
      claim: {
        formatId: 'html',
        extensions: ['.html', '.htm', '.vue'],
        language: 'html',
        ownerVersion: installedParserVersion,
        contractVersion: '1',
      },
    })
  })

  it('yields one region per script with offsets into the original document', function*({ expect }) {
    const document = parsedDocument(TWO_SCRIPT_HTML, toolkit())
    yield* expect({
      formatId: document.formatId,
      rawContent: document.rawContent,
      slices: slicesOf(document),
      expressionFlags: document.regions.map((region) => region.isExpression),
    }).toEqual({
      formatId: 'html',
      rawContent: TWO_SCRIPT_HTML,
      slices: [FIRST_SCRIPT_BODY, SECOND_SCRIPT_BODY],
      expressionFlags: [false, false],
    })
  })

  it('yields only the script region of a Vue component, parsed as TypeScript', function*({ expect }) {
    const recorded = recordingToolkit()
    const document = parsedDocument(VUE_COMPONENT, recorded.context)
    yield* expect({
      slices: slicesOf(document),
      formats: recorded.formats,
      sources: recorded.sources,
    }).toEqual({ slices: [VUE_SCRIPT_BODY], formats: ['ts'], sources: [VUE_SCRIPT_BODY] })
  })

  it('hands the transform through unchanged', function*({ expect }) {
    const context = toolkit()
    const document = parsedDocument(TWO_SCRIPT_HTML, context)
    yield* expect(angular().transform(document, context)).toStrictEqual(document)
  })

  it('prints an untransformed document byte-for-byte', function*({ expect }) {
    const context = toolkit()
    const document = parsedDocument(TWO_SCRIPT_HTML, context)
    yield* expect(angular().print(document, context)).toBe(TWO_SCRIPT_HTML)
  })

  it('starts each script region type-check free', function*({ expect }) {
    yield* expect(typeCheckFree(TWO_SCRIPT_HTML)).toBe(TWO_SCRIPT_HTML_NO_CHECK)
  })

  it('keeps the @ts-nocheck comment after a leading hashbang', function*({ expect }) {
    yield* expect(typeCheckFree(HASHBANG_HTML)).toBe(HASHBANG_HTML_NO_CHECK)
  })

  it('leaves a hashbang without a newline alone', function*({ expect }) {
    yield* expect(typeCheckFree(HASHBANG_WITHOUT_NEWLINE_HTML)).toBe(HASHBANG_WITHOUT_NEWLINE_HTML)
  })

  it('keeps the @ts-nocheck comment after a leading block comment', function*({ expect }) {
    yield* expect(typeCheckFree(LEADING_COMMENT_HTML)).toBe(LEADING_COMMENT_HTML_NO_CHECK)
  })

  it('refuses a script tag that never closes instead of passing it through', function*({ expect }) {
    yield* expect(failedParse(UNCLOSED_SCRIPT_HTML, toolkit())).toContain('EOF')
  })

  it('refuses type-check disabling for a script tag that never closes', function*({ expect }) {
    yield* expect(failedTypeCheckFree(UNCLOSED_SCRIPT_HTML)).toContain('EOF')
  })

  it('ignores script tags with a src attribute and scripts with an unknown type', function*({ expect }) {
    const document = parsedDocument(FILTERED_HTML, toolkit())
    yield* expect(slicesOf(document)).toEqual([])
  })

  it('prefers the type attribute over the lang attribute for the script vocabulary', function*({ expect }) {
    const recorded = recordingToolkit()
    parsedDocument(TYPE_PRECEDENCE_HTML, recorded.context)
    yield* expect(recorded.formats).toStrictEqual(['ts'])
  })

  it('contains a toolkit that crashes with an Error as a parse failure', function*({ expect }) {
    const message = failedParse(SINGLE_SCRIPT_HTML, crashingToolkit(new Error('the toolkit refused the script')))
    yield* expect(message).toBe('the toolkit refused the script')
  })

  it('contains a toolkit that crashes with a non-Error as a parse failure', function*({ expect }) {
    const message = failedParse(SINGLE_SCRIPT_HTML, crashingToolkit('the toolkit exploded'))
    yield* expect(message).toBe('the Angular parser reported a failure that is not an Error')
  })
})
