import type { EmbeddedDocument, Framework, ScriptRegion, Statement } from '@systemfsoftware/stryker-framework-interface'
import { describe, expect, it } from 'vitest'

import type { FrameworkContribution } from '@systemfsoftware/stryker-framework-interface'
import * as installedWalker from 'oxc-walker'
import * as installedCompiler from 'svelte/compiler'
import { frameworkOf } from '../src/compiler-resolution.js'
import * as fixtureWalker from './__fixtures__/peer-oxc-walker.mjs'
import * as floorPeer from './__fixtures__/peer-svelte-floor.mjs'
import {
  childlessScriptCompiler,
  hashbangCompiler,
  hashbangSource,
  langAttributeCompiler,
  noHtmlCompiler,
  rangelessScriptCompiler,
  swappedScriptsCompiler,
  testWalker,
  throwingCompiler,
} from './__fixtures__/svelte-test-compilers.js'
import { recordingToolkit } from './__fixtures__/toolkit.js'

const INSTALLED_VERSION: string = installedCompiler.VERSION

const COMPONENT = `<script>\n  export let n = 1\n  const big = n > 10\n</script>\n<p>{big}</p>\n`

const MODULE_COMPONENT =
  `<script context="module">\n  export const shared = 1\n</script>\n<script>\n  export let n = 1\n</script>\n`

const TS_COMPONENT = `<script lang="ts">\n  let n: number = 1\n</script>\n<p>{n}</p>\n`

const HEADER: readonly Statement[] = [
  {
    type: 'ExpressionStatement',
    expression: { type: 'Identifier', name: 'stryMutAct', start: 0, end: 10 },
    start: 0,
    end: 10,
  },
  {
    type: 'ExpressionStatement',
    expression: { type: 'Identifier', name: 'stryCov', start: 11, end: 20 },
    start: 11,
    end: 20,
  },
]
const installedCompilerModules = (): unknown => {
  const masked: Record<string, unknown> = {
    VERSION: INSTALLED_VERSION,
    parse: installedCompiler.parse,
  }
  return masked
}

const installed = (): { framework: Framework; version: string } => {
  const contribution: FrameworkContribution = frameworkOf(installedCompilerModules(), installedWalker)
  if (contribution.kind !== 'Framework') {
    throw new Error('the installed svelte compiler must serve a framework')
  }
  return { framework: contribution, version: INSTALLED_VERSION }
}

const fixtureFramework = (): Framework => {
  const contribution: FrameworkContribution = frameworkOf(floorPeer, fixtureWalker)
  if (contribution.kind !== 'Framework') {
    throw new Error('the fixture compiler must serve a framework')
  }
  return contribution
}

const frameworkOfCompiler = (compiler: unknown): Framework => {
  const contribution: FrameworkContribution = frameworkOf(compiler, testWalker)
  if (contribution.kind !== 'Framework') {
    throw new Error('expected a framework')
  }
  return contribution
}

const spansOf = (document: EmbeddedDocument): readonly string[] =>
  document.regions.map((region) => `${region.start}-${region.end}`)

const documentOf = (framework: Framework, raw: string, toolkit = recordingToolkit([])): EmbeddedDocument => {
  const parsed = framework.parse(raw, toolkit.toolkit)
  if (parsed.kind !== 'Parsed') {
    throw new Error(`expected a parsed document: ${parsed.message}`)
  }
  return parsed.value
}

const bodyOf = (ast: unknown): readonly unknown[] => {
  if (typeof ast !== 'object' || ast === null) {
    return []
  }
  const body: unknown = Reflect.get(ast, 'body')
  return Array.isArray(body) ? body : []
}

const bodyLengthsOf = (document: EmbeddedDocument): readonly number[] =>
  document.regions.map((region) => bodyOf(region.scriptAst).length)

const placedHeaderIn = (document: EmbeddedDocument, index: number): void => {
  const region: ScriptRegion | undefined = document.regions.at(index)
  const body = bodyOf(region?.scriptAst)
  if (Array.isArray(body)) {
    body.unshift(...HEADER.map((statement) => ({ ...statement })))
  }
}

describe('svelte format with the installed compiler', () => {
  it('Hands_Over_The_Instance_Script_And_Its_Template_Expression', () => {
    const { framework } = installed()
    const recorder = recordingToolkit([])
    const document = documentOf(framework, COMPONENT, recorder)
    const scriptStart = COMPONENT.indexOf('<script>') + '<script>'.length
    const scriptEnd = COMPONENT.indexOf('</script>')
    const expressionStart = COMPONENT.indexOf('{big}') + 1
    expect(document.formatId).toBe('svelte')
    expect(spansOf(document)).toStrictEqual([
      `${scriptStart}-${scriptEnd}`,
      `${expressionStart}-${expressionStart + 'big'.length}`,
    ])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([false, true])
    expect(recorder.recorded.map((script) => script.source)).toStrictEqual([
      COMPONENT.substring(scriptStart, scriptEnd),
      'big',
    ])
    expect(recorder.recorded.map((script) => script.scriptFormat)).toStrictEqual(['js', 'js'])
  })

  it('Finds_Both_The_Module_And_The_Instance_Script', () => {
    const { framework } = installed()
    const recorder = recordingToolkit([])
    const document = documentOf(framework, MODULE_COMPONENT, recorder)
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([false, false])
    const moduleEnd = MODULE_COMPONENT.indexOf('</script>')
    const secondScript = MODULE_COMPONENT.indexOf('<script>', moduleEnd)
    const secondClose = MODULE_COMPONENT.indexOf('>', secondScript)
    const instanceEnd = MODULE_COMPONENT.indexOf('</script>', moduleEnd + 1)
    expect(spansOf(document)).toStrictEqual([
      `${MODULE_COMPONENT.indexOf('>') + 1}-${moduleEnd}`,
      `${secondClose + 1}-${instanceEnd}`,
    ])
  })

  it('Reads_A_Typescript_Script_As_Typescript', () => {
    const { framework } = installed()
    const recorder = recordingToolkit([])
    const document = documentOf(framework, TS_COMPONENT, recorder)
    expect(document.regions.length).toBe(2)
    expect(recorder.recorded[0]?.scriptFormat).toBe('ts')
  })

  it('Prints_Every_Script_Between_Its_Own_Boundaries', () => {
    const { framework } = installed()
    const recorder = recordingToolkit([], (source) => `${source};`)
    const document = documentOf(framework, COMPONENT, recorder)
    const printed = framework.print(document, recorder.toolkit)
    const scriptStart = COMPONENT.indexOf('<script>') + '<script>'.length
    const scriptEnd = COMPONENT.indexOf('</script>')
    expect(printed).toBe(
      `${COMPONENT.substring(0, scriptStart)}\n${COMPONENT.substring(scriptStart, scriptEnd)};\n${
        COMPONENT.substring(scriptEnd, COMPONENT.indexOf('{big}') + 1)
      }big${COMPONENT.substring(COMPONENT.indexOf('{big}') + 'big'.length + 1)}`,
    )
  })

  it('Reads_The_Same_Regions_Back_From_Its_Print', () => {
    const { framework } = installed()
    const recorder = recordingToolkit([], (source) => `${source};`)
    const document = documentOf(framework, COMPONENT, recorder)
    const printed = framework.print(document, recorder.toolkit)
    const reparsed = documentOf(framework, printed, recordingToolkit([]))
    expect(reparsed.regions.map((region) => region.isExpression)).toStrictEqual(
      document.regions.map((region) => region.isExpression),
    )
  })

  it('Leaves_A_Component_No_Mutant_Lands_In_Alone', () => {
    const { framework } = installed()
    const recorder = recordingToolkit([])
    const document = documentOf(framework, COMPONENT, recorder)
    const prepared = framework.transform(document, recorder.toolkit)
    expect(prepared).toBe(document)
    expect(prepared.rawContent).toBe(COMPONENT)
    expect(bodyLengthsOf(prepared)).toStrictEqual([2, 1])
  })

  it('Opens_A_Module_Script_Once_A_Mutant_Lands', () => {
    const { framework } = installed()
    const recorder = recordingToolkit(HEADER)
    const document = documentOf(framework, COMPONENT, recorder)
    placedHeaderIn(document, 0)
    placedHeaderIn(document, 1)
    const prepared = framework.transform(document, recorder.toolkit)
    expect(prepared.rawContent.startsWith('<script context="module">')).toBe(true)
    expect(bodyLengthsOf(prepared)).toStrictEqual([HEADER.length, 2, 1])
  })

  it('Keeps_The_Header_Inside_A_Declared_Module_Script', () => {
    const { framework } = installed()
    const recorder = recordingToolkit(HEADER)
    const document = documentOf(framework, MODULE_COMPONENT, recorder)
    placedHeaderIn(document, 0)
    const prepared = framework.transform(document, recorder.toolkit)
    expect(prepared.rawContent).toBe(MODULE_COMPONENT)
    expect(bodyLengthsOf(prepared)).toStrictEqual([HEADER.length + 1, 1])
  })

  it('Marks_Every_Script_Region_Type_Check_Free', () => {
    const { framework } = installed()
    const disabled = framework.disableTypeChecks(COMPONENT)
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value.split('// @ts-nocheck').length - 1).toBe(2)
    expect(disabled.value).toContain('export let n = 1')
    expect(disabled.value).toContain('</script>')
  })

  it('Declares_The_Svelte_Format_For_The_Svelte_Extension', () => {
    const { framework, version } = installed()
    expect(framework.claim).toStrictEqual({
      formatId: 'svelte',
      extensions: ['.svelte'],
      language: 'svelte',
      ownerVersion: version,
      contractVersion: '1',
    })
    expect(framework.kind).toBe('Framework')
    expect(framework.name).toBe('svelte')
  })
})

describe('svelte format with fixture compilers', () => {
  const FIXTURE_COMPONENT = '<script>\n  export let n = 1\n</script>\n<p>{n}</p>\n'

  it('Walks_Script_Elements_Found_In_The_Template', () => {
    const recorder = recordingToolkit([])
    const document = documentOf(fixtureFramework(), FIXTURE_COMPONENT, recorder)
    expect(spansOf(document)).toStrictEqual(['8-28', '42-43'])
    expect(document.regions.map((region) => region.isExpression)).toStrictEqual([false, true])
  })

  it('Skips_A_Script_Element_Without_A_Ranged_Text_Child', () => {
    const framework = frameworkOfCompiler(childlessScriptCompiler)
    const document = documentOf(framework, FIXTURE_COMPONENT, recordingToolkit([]))
    expect(document.regions).toStrictEqual([])
  })

  it('Reads_A_Language_Attribute_As_The_Script_Format', () => {
    const framework = frameworkOfCompiler(langAttributeCompiler)
    const recorder = recordingToolkit([])
    void documentOf(framework, FIXTURE_COMPONENT, recorder)
    expect(recorder.recorded[0]?.scriptFormat).toBe('ts')
  })

  it('Places_The_Header_Into_The_Module_Region_When_It_Sorts_After', () => {
    const framework = frameworkOfCompiler(swappedScriptsCompiler)
    const recorder = recordingToolkit(HEADER)
    const document = documentOf(framework, 'x'.repeat(70), recorder)
    expect(spansOf(document)).toStrictEqual(['8-30', '40-62'])
    placedHeaderIn(document, 0)
    const prepared = framework.transform(document, recorder.toolkit)
    expect(prepared.rawContent).toBe('x'.repeat(70))
    expect(bodyLengthsOf(prepared)).toStrictEqual([1, HEADER.length + 1])
  })

  it('Trims_The_Expression_Terminator_When_Printing', () => {
    const recorder = recordingToolkit([], (source) => `${source};`)
    const document = documentOf(fixtureFramework(), FIXTURE_COMPONENT, recorder)
    const printed = fixtureFramework().print(document, recorder.toolkit)
    expect(printed).toContain('{n}')
    expect(printed).not.toContain('n;')
    expect(printed).toContain('<script>\n\n  export let n = 1')
  })
})

describe('svelte format failures', () => {
  it('Reports_A_Compiler_Without_An_Html_Root', () => {
    const framework = frameworkOfCompiler(noHtmlCompiler)
    expect(framework.parse('<p>hi</p>', recordingToolkit([]).toolkit)).toStrictEqual({
      kind: 'ParseFailed',
      message: 'Svelte AST without html',
    })
  })

  it('Reports_A_Script_Without_A_Source_Range', () => {
    const framework = frameworkOfCompiler(rangelessScriptCompiler)
    expect(framework.parse('<script></script>', recordingToolkit([]).toolkit)).toStrictEqual({
      kind: 'ParseFailed',
      message: 'Svelte script without a source range',
    })
  })

  it('Reports_A_Compiler_Throw_As_A_Parse_Failure', () => {
    const framework = frameworkOfCompiler(throwingCompiler(new Error('nope')))
    expect(framework.parse('<p>hi</p>', recordingToolkit([]).toolkit)).toStrictEqual({
      kind: 'ParseFailed',
      message: 'nope',
    })
  })

  it('Reports_A_Non_Error_Throw_As_A_Parse_Failure', () => {
    const framework = frameworkOfCompiler(throwingCompiler('boom'))
    expect(framework.parse('<p>hi</p>', recordingToolkit([]).toolkit)).toStrictEqual({
      kind: 'ParseFailed',
      message: 'the svelte compiler reported a failure that is not an Error',
    })
  })

  it('Reports_A_Type_Check_Failure_When_Discovery_Fails', () => {
    const framework = frameworkOfCompiler(noHtmlCompiler)
    expect(framework.disableTypeChecks('<p>hi</p>')).toStrictEqual({
      kind: 'ParseFailed',
      message: 'Svelte AST without html',
    })
  })

  it('Throws_When_A_Region_Has_No_Program', () => {
    const framework = frameworkOfCompiler(swappedScriptsCompiler)
    const document = documentOf(framework, 'x'.repeat(70), recordingToolkit([]))
    const broken = { ...document, regions: [{ start: 0, end: 1, isExpression: false }] }
    expect(() => framework.print(broken, recordingToolkit([]).toolkit)).toThrow('without its parsed program')
  })
})

describe('svelte format no-check splicing', () => {
  it('Splices_A_Hashbang_Script_After_The_First_Line', () => {
    const framework = frameworkOfCompiler(hashbangCompiler)
    const source = hashbangSource('#!/usr/bin/env node\nexport let n = 1')
    const disabled = framework.disableTypeChecks(source)
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toBe(
      `${source.substring(0, 8)}\n#!/usr/bin/env node\n// @ts-nocheck\nexport let n = 1\n${
        source.substring(source.indexOf('</script>'))
      }`,
    )
  })

  it('Leaves_A_Newline_Free_Hashbang_Alone', () => {
    const framework = frameworkOfCompiler(hashbangCompiler)
    const source = hashbangSource('#!/usr/bin/env node')
    const disabled = framework.disableTypeChecks(source)
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toBe(
      `${source.substring(0, 8)}\n#!/usr/bin/env node\n${source.substring(source.indexOf('</script>'))}`,
    )
  })

  it('Splices_The_No_Check_After_A_Leading_Comment', () => {
    const framework = fixtureFramework()
    const disabled = framework.disableTypeChecks('<script>\n  /* lead */\n  export let n = 1\n</script>\n<p>{n}</p>\n')
    if (disabled.kind !== 'Parsed') {
      throw new Error('expected type checks to be disabled')
    }
    expect(disabled.value).toContain('/* lead */\n// @ts-nocheck')
  })
})
