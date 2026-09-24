import type {
  EmbeddedDocument,
  Framework,
  FrameworkParseResult,
  Program,
  ScriptFormat,
  Statement,
} from '@systemfsoftware/stryker-framework-interface'
import type { AST } from 'svelte/compiler'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

import type { CompilerModule } from '../src/compiler.js'
import { svelteFramework } from '../src/framework.js'
import { recordingToolkit } from './__fixtures__/toolkit.js'

const installedCompiler: CompilerModule = {
  VERSION: '5.57.0',
  parse: (source, options) => parse(source, options),
}

const INSTALLED_COMPONENT = [
  '<script module>',
  '  export const shared = 1',
  '</script>',
  '<script lang="ts">',
  '  let n: number = 1',
  '  const doubled = n * 2',
  '</script>',
  '<p>{n}</p>',
  '{@html doubled}',
  '{@const halved = n / 2}',
  '{#if n > 1}<b>{n}</b>{:else}<b>small</b>{/if}',
  '{#each [n] as item (item)}<li>{item}</li>{/each}',
  '{#await Promise.resolve(n) then value}{value}{/await}',
  '{#key n}<span>{n}</span>{/key}',
  '{#snippet greet(name)}<em>{name}</em>{/snippet}',
  '{@render greet(n)}',
  '<button onclick={n} class:active={n > 0} style:color={n} use:noop={n} transition:fade={n} animate:flip={n} bind:value={n} {...{ n }} data-n={n}>go</button>',
  '<svelte:component this={Widget} />',
  '<svelte:element this={tag} />',
  '',
].join('\n')

const EXPECTED_SLICES: readonly {
  readonly slice: string
  readonly expression: boolean
  readonly format: ScriptFormat
}[] = [
  { slice: '\n  export const shared = 1\n', expression: false, format: 'js' },
  { slice: '\n  let n: number = 1\n  const doubled = n * 2\n', expression: false, format: 'ts' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'doubled', expression: true, format: 'js' },
  { slice: 'n / 2', expression: true, format: 'js' },
  { slice: 'n > 1', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: '[n]', expression: true, format: 'js' },
  { slice: 'item', expression: true, format: 'js' },
  { slice: 'item', expression: true, format: 'js' },
  { slice: 'Promise.resolve(n)', expression: true, format: 'js' },
  { slice: 'value', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'name', expression: true, format: 'js' },
  { slice: 'greet(n)', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'n > 0', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: '{ n }', expression: true, format: 'js' },
  { slice: 'n', expression: true, format: 'js' },
  { slice: 'Widget', expression: true, format: 'js' },
  { slice: 'tag', expression: true, format: 'js' },
]

const headerStatement = (name: string, start: number, end: number): Statement => ({
  type: 'ExpressionStatement',
  expression: { type: 'Identifier', name, start, end },
  start,
  end,
})

const HEADER: readonly Statement[] = [headerStatement('stryMutAct', 0, 10), headerStatement('stryCov', 11, 20)]

const LEGACY_MODULE_COMPONENT = [
  '<script context="module">',
  '  export const shared = 1',
  '</script>',
  '<script>',
  '  export const n = 1',
  '</script>',
  '<p>{n}</p>',
  '',
].join('\n')

const MODULE_LAST_COMPONENT = [
  '<script>',
  '  export const n = 1',
  '</script>',
  '<script module>',
  '  export const shared = 1',
  '</script>',
  '',
].join('\n')

const NO_SCRIPT_COMPONENT = '<p>{1 + 2}</p>\n'

const BARE_DIRECTIVE_COMPONENT = [
  '<script>',
  '  export const n = 1',
  '</script>',
  '<button onclick class:active={n} style:color title="a{n}b" on:click let:item>go</button>',
  '',
].join('\n')

const DIRECTIVE_COMPONENT = [
  '<script>',
  '  // @ts-ignore',
  '  /* @ts-expect-error */',
  '  export const n = 1 // kept',
  '</script>',
  '<p>{@const halved = 1 /* @ts-ignore */ + 1}{n}</p>',
  '',
].join('\n')

const DIRECTIVE_FREE_COMPONENT = [
  '<script>',
  '// @ts-nocheck',
  '',
  '  // ',
  '  /*  */',
  '  export const n = 1 // kept',
  '',
  '</script>',
  '<p>{@const halved = 1 /*  */ + 1}{n}</p>',
  '',
].join('\n')
const COMMENT_LEAD_FREE = [
  '<script>',
  '',
  '/* lead */',
  '// @ts-nocheck',
  '',
  'export const n = 1',
  '',
  '</script>',
  '',
].join(
  '\n',
)
const COMMENT_LEAD_COMPONENT = ['<script>', '/* lead */', 'export const n = 1', '</script>', ''].join('\n')

const framework = (): Framework => svelteFramework(installedCompiler)

const parsedDocument = (raw: string, toolkit = recordingToolkit([])): EmbeddedDocument => {
  const parsed: FrameworkParseResult<EmbeddedDocument> = framework().parse(raw, toolkit.toolkit)
  if (parsed.kind !== 'Parsed') {
    throw new Error(`the component did not parse: ${parsed.message}`)
  }
  return parsed.value
}

const typeCheckFree = (raw: string): string => {
  const disabled: FrameworkParseResult<string> = framework().disableTypeChecks(raw)
  if (disabled.kind !== 'Parsed') {
    throw new Error(`type-check disabling failed: ${disabled.message}`)
  }
  return disabled.value
}

const failedParse = (raw: string): string => {
  const parsed: FrameworkParseResult<EmbeddedDocument> = framework().parse(raw, recordingToolkit([]).toolkit)
  if (parsed.kind !== 'ParseFailed') {
    throw new Error('the component unexpectedly parsed')
  }
  return parsed.message
}

const placeHeader = (document: EmbeddedDocument, index: number): void => {
  const region = document.regions.at(index)
  if (region === undefined) {
    throw new Error('the region is missing')
  }
  region.scriptAst.body.unshift(headerStatement('stryMutAct', 0, 10), headerStatement('stryCov', 11, 20))
}

const bodyLengthsOf = (document: EmbeddedDocument): readonly number[] =>
  document.regions.map((region) => programOf(region.scriptAst).body.length)

const programOf = (program: Program): Program => program

describe('svelte parse against the installed compiler', () => {
  it('hands over every script and template expression with its offsets, flags, and format', () => {
    const recorder = recordingToolkit([])
    const document = parsedDocument(INSTALLED_COMPONENT, recorder)
    expect(document.formatId).toBe('svelte')
    expect(document.rawContent).toBe(INSTALLED_COMPONENT)
    expect(document.regions.map((region) => INSTALLED_COMPONENT.slice(region.start, region.end))).toStrictEqual(
      EXPECTED_SLICES.map((expected) => expected.slice),
    )
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual(
      EXPECTED_SLICES.map((expected) => expected.expression),
    )
    expect(recorder.recorded.map((script) => script.source)).toStrictEqual(
      EXPECTED_SLICES.map((expected) => expected.slice),
    )
    expect(recorder.recorded.map((script) => script.scriptFormat)).toStrictEqual(
      EXPECTED_SLICES.map((expected) => expected.format),
    )
  })

  it('claims bare directives and quoted values as their expression parts', () => {
    const document = parsedDocument(BARE_DIRECTIVE_COMPONENT, recordingToolkit([]))
    expect(document.regions.map((region) => BARE_DIRECTIVE_COMPONENT.slice(region.start, region.end))).toStrictEqual([
      '\n  export const n = 1\n',
      'n',
      'n',
    ])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([false, true, true])
  })

  it('recognizes a module script written with the Svelte 4 context attribute', () => {
    const document = parsedDocument(LEGACY_MODULE_COMPONENT, recordingToolkit([]))
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([false, false, true])
    expect(document.regions).toHaveLength(3)
  })

  it('claims the initializer of a let declaration', () => {
    const source = '{let x = 1}<p>hi</p>'
    const document = parsedDocument(source, recordingToolkit([]))
    expect(document.regions.map((region) => source.slice(region.start, region.end))).toStrictEqual(['1'])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([true])
  })

  it('claims no region for a let declaration without an initializer', () => {
    const document = parsedDocument('{let x}<p>hi</p>', recordingToolkit([]))
    expect(document.regions).toHaveLength(0)
  })

  it('claims no key region for an each block without a key', () => {
    const source = '{#each [n] as item}<li>{item}</li>{/each}'
    const document = parsedDocument(source, recordingToolkit([]))
    expect(document.regions.map((region) => source.slice(region.start, region.end))).toStrictEqual(['[n]', 'item'])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([true, true])
  })

  it('claims the expression of an attach attribute', () => {
    const source = '<div {@attach foo}>go</div>'
    const document = parsedDocument(source, recordingToolkit([]))
    expect(document.regions.map((region) => source.slice(region.start, region.end))).toStrictEqual(['foo'])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([true])
  })

  it('finds the module script when it sorts after the instance script', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(MODULE_LAST_COMPONENT, recorder)
    placeHeader(document, 1)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(bodyLengthsOf(prepared)).toStrictEqual([1, HEADER.length + 1])
  })
  it('reports a broken component as a parse failure with the compiler message', () => {
    expect(failedParse('<p>{(</p>')).toBe('Unexpected token\nhttps://svelte.dev/e/js_parse_error')
  })
  it('reports a thrown non-error as a parse failure naming the failure shape', () => {
    const compiler: CompilerModule = {
      VERSION: '5.0.0',
      parse: () => {
        throw 'boom'
      },
    }
    const parsed = svelteFramework(compiler).parse('<p>hi</p>', recordingToolkit([]).toolkit)
    expect(parsed).toStrictEqual({
      kind: 'ParseFailed',
      message: 'the svelte compiler reported a failure that is not an Error',
    })
  })
})

const hashbangProgram = (): Program => ({
  type: 'Program',
  start: 0,
  end: 40,
  sourceType: 'module' as Program['sourceType'],
  body: [],
  hashbang: null,
})

const hashbangRoot = (end: number): AST.Root => ({
  type: 'Root',
  start: 0,
  end,
  options: null,
  fragment: { type: 'Fragment', nodes: [] },
  css: null,
  instance: {
    type: 'Script',
    start: 0,
    end,
    context: 'default',
    content: { ...hashbangProgram(), end } as AST.Script['content'],
    attributes: [],
  },
  module: null,
  comments: [],
})

describe('svelte hashbang handling with a synthetic compiler', () => {
  it('keeps a hashbang leading script through type-check disabling', () => {
    const compiler: CompilerModule = { VERSION: '5.0.0', parse: () => hashbangRoot(40) }
    const disabled = svelteFramework(compiler).disableTypeChecks('#!/usr/bin/env node\nexport const n = 1')
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toBe('\n#!/usr/bin/env node\n// @ts-nocheck\nexport const n = 1\n')
  })

  it('leaves a newline-free hashbang script alone', () => {
    const compiler: CompilerModule = { VERSION: '5.0.0', parse: () => hashbangRoot(7) }
    const disabled = svelteFramework(compiler).disableTypeChecks('#!node\n')
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toBe('\n#!node\n// @ts-nocheck\n\n')
  })

  it('leaves a newline-free plain script alone', () => {
    const compiler: CompilerModule = { VERSION: '5.0.0', parse: () => hashbangRoot(6) }
    const disabled = svelteFramework(compiler).disableTypeChecks('#node\n')
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toBe('\n#node\n// @ts-nocheck\n\n')
  })

  it('leaves a single-character script alone', () => {
    const compiler: CompilerModule = { VERSION: '5.0.0', parse: () => hashbangRoot(1) }
    const disabled = svelteFramework(compiler).disableTypeChecks('#')
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toBe('\n#\n')
  })

  it('reports an unmatched thrown value as the failure shape', () => {
    const compiler: CompilerModule = {
      VERSION: '5.0.0',
      parse: () => {
        throw 'boom'
      },
    }
    expect(svelteFramework(compiler).disableTypeChecks('<p>hi</p>')).toStrictEqual({
      kind: 'ParseFailed',
      message: 'the svelte compiler reported a failure that is not an Error',
    })
  })
})

describe('svelte transform against the installed compiler', () => {
  it('leaves a component no mutant lands in alone', () => {
    const recorder = recordingToolkit([])
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(prepared).toBe(document)
    expect(bodyLengthsOf(prepared)).toStrictEqual([1])
  })

  it('places the header in a leading module script through the shared placement', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(INSTALLED_COMPONENT, recorder)
    placeHeader(document, 0)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(bodyLengthsOf(prepared)[0]).toBe(1 + HEADER.length)
  })
  it('opens a module script when the placed header lands in the module script', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(MODULE_LAST_COMPONENT, recorder)
    placeHeader(document, 1)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(prepared.rawContent).toBe(MODULE_LAST_COMPONENT)
    expect(bodyLengthsOf(prepared)).toStrictEqual([1, HEADER.length + 1])
  })

  it('opens a fresh module script when the document carries no module region', () => {
    const compiler: CompilerModule = { VERSION: '5.0.0', parse: () => hashbangRoot(40) }
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    placeHeader(document, 0)
    const prepared = svelteFramework(compiler).transform(document, recorder.toolkit)
    expect(prepared.rawContent.startsWith('<script module>\n')).toBe(true)
    expect(bodyLengthsOf(prepared)).toStrictEqual([HEADER.length, 1])
  })

  it('falls back to JavaScript when a fresh discovery reports no scripts', () => {
    const compiler: CompilerModule = {
      VERSION: '5.0.0',
      parse: () => {
        throw 'boom'
      },
    }
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    placeHeader(document, 0)
    const prepared = svelteFramework(compiler).transform(document, recorder.toolkit)
    expect(prepared.rawContent.startsWith('<script module>\n')).toBe(true)
  })

  it('opens a Svelte 5 module script once a mutant lands', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(prepared.rawContent).toBe(NO_SCRIPT_COMPONENT)
    expect(bodyLengthsOf(prepared)).toStrictEqual([1])
  })

  it('places the header in a leading module script through the shared placement', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(INSTALLED_COMPONENT, recorder)
    placeHeader(document, 0)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(bodyLengthsOf(prepared)[0]).toBe(1 + HEADER.length)
  })

  it('opens a TypeScript module script once a mutant lands in a TypeScript component', () => {
    const source = '<script lang="ts">\n  let n: number = 1\n</script>\n<p>{n}</p>\n'
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(source, recorder)
    placeHeader(document, 0)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(prepared.rawContent).toBe(`<script module lang="ts">\n\n</script>\n${source}`)
    expect(bodyLengthsOf(prepared)).toStrictEqual([HEADER.length, 1, 1])
  })

  it('keeps the header inside a declared module script', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(INSTALLED_COMPONENT, recorder)
    placeHeader(document, 1)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(prepared.rawContent).toBe(INSTALLED_COMPONENT)
    expect(bodyLengthsOf(prepared)[0]).toBe(1 + HEADER.length)
  })

  it('prints the relocated header in the opened module script', () => {
    const recorder = recordingToolkit(HEADER)
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    placeHeader(document, 0)
    const prepared = framework().transform(document, recorder.toolkit)
    expect(framework().print(prepared, recorder.toolkit)).toBe(
      `<script module>\n\nstryMutAct;\nstryCov;\n\n</script>\n<p>{1 + 2}</p>\n`,
    )
  })

  it('leaves expression text uncut when the printer emits no trailing semicolon', () => {
    const recorder = recordingToolkit([], (source) => source)
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    expect(framework().print(document, recorder.toolkit)).toBe(NO_SCRIPT_COMPONENT)
  })

  it('strips one trailing semicolon from an instrumented expression region', () => {
    const recorder = recordingToolkit([], () => 'count + 1;')
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    expect(framework().print(document, recorder.toolkit)).toBe('<p>{count + 1}</p>\n')
  })

  it('strips the semicolon when the printer terminates the line', () => {
    const recorder = recordingToolkit([], () => 'count + 1;\n')
    const document = parsedDocument(NO_SCRIPT_COMPONENT, recorder)
    expect(framework().print(document, recorder.toolkit)).toBe('<p>{count + 1}</p>\n')
  })
})

describe('svelte type-check disabling against the installed compiler', () => {
  it('starts each script type-check free while leaving template expressions alone', () => {
    const disabled = typeCheckFree(NO_SCRIPT_COMPONENT)
    expect(disabled).toBe(NO_SCRIPT_COMPONENT)
  })

  it('marks the instance and module scripts of a component', () => {
    const disabled = typeCheckFree(INSTALLED_COMPONENT)
    expect(disabled.split('// @ts-nocheck').length - 1).toBe(2)
  })

  it('keeps the no-check comment after a leading block comment', () => {
    expect(typeCheckFree(COMMENT_LEAD_COMPONENT)).toBe(COMMENT_LEAD_FREE)
  })

  it('strips TypeScript directive comments from scripts and template expressions', () => {
    expect(typeCheckFree(DIRECTIVE_COMPONENT)).toBe(DIRECTIVE_FREE_COMPONENT)
  })

  it('refuses type-check disabling for a broken component', () => {
    expect(framework().disableTypeChecks('<p>{(</p>')).toStrictEqual({
      kind: 'ParseFailed',
      message: 'Unexpected token\nhttps://svelte.dev/e/js_parse_error',
    })
  })

  it('leaves non-directive comments in scripts alone', () => {
    const source = '<script>\n  /* keep */\n  export const n = 1\n</script>\n'
    expect(typeCheckFree(source)).toBe(
      '<script>\n\n  /* keep */\n// @ts-nocheck\n\n  export const n = 1\n\n</script>\n',
    )
  })
})
