import type { EmbeddedDocument, FrameworkContext, FrameworkService } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import { type Program, programFromParseResult, programOf, type Statement } from './Ast.js'
import { type EmbeddedFormatEntry, formatIdOf } from './format-registry.js'
import { loadOxc, type Oxc } from './Oxc.js'
import type { ParserContext } from './Parser.js'
import { ParseFailed } from './Parser.schema.js'
import { printProgram } from './print/index.js'
import type { PrinterContext } from './Printer.js'
import { type Ast, type EmbeddedAst, type EmbeddedScript, type ScriptAst, type ScriptFormat } from './Syntax.js'
import { instrumentationHeader, type MutantCollector, transform, type TransformerContext } from './Transformer.js'

const EMBEDDED_SCRIPT_FILE = 'embedded-script.js'

interface FrameworkToolkit {
  readonly parseScript: (source: string, scriptFormat: ScriptFormat) => Program
  readonly header: readonly Statement[]
}

let frameworkToolkitValue: FrameworkToolkit | undefined
let frameworkToolkitLoad: Promise<FrameworkToolkit> | undefined

const loadFrameworkToolkit = async (): Promise<FrameworkToolkit> => {
  const oxc = await loadOxc()
  const header = await instrumentationHeader()
  const loaded: FrameworkToolkit = {
    parseScript: (source, scriptFormat) => parseScriptProgram(oxc, source, scriptFormat),
    header,
  }
  frameworkToolkitValue = loaded
  return loaded
}

const loadToolkitOnce = async (): Promise<FrameworkToolkit> => {
  if (frameworkToolkitLoad === undefined) {
    frameworkToolkitLoad = loadFrameworkToolkit()
  }
  return frameworkToolkitLoad
}

const frameworkToolkit = async (): Promise<FrameworkToolkit> => {
  if (frameworkToolkitValue !== undefined) {
    return frameworkToolkitValue
  }
  frameworkToolkitValue = await loadToolkitOnce()
  return frameworkToolkitValue
}

const loadedToolkit = (): FrameworkToolkit => {
  if (frameworkToolkitValue === undefined) {
    throw new Error('The framework format toolkit was used before its parser was loaded')
  }
  return frameworkToolkitValue
}

const parseScriptProgram = (oxc: Oxc, source: string, scriptFormat: ScriptFormat): Program => {
  const result = oxc.parseSync(EMBEDDED_SCRIPT_FILE, source, { lang: scriptFormat, range: true })
  const first = result.errors.at(0)
  if (first !== undefined) {
    throw new ParseFailed({
      fileName: EMBEDDED_SCRIPT_FILE,
      message: first.message,
      location: { line: 0, column: 0 },
      cause: first,
    })
  }
  return programFromParseResult(result.program)
}

const applyInstrumentationHeader = (script: Program): Program => {
  script.body.unshift(...loadedToolkit().header)
  return script
}

const frameworkContextOf = (): FrameworkContext => {
  const { parseScript, header } = loadedToolkit()
  return {
    parseScript,
    transformScript: applyInstrumentationHeader,
    printScript: (script) => printProgram(script, { hashbang: null }),
    instrumentationHeader: () => header,
  }
}

const embeddedScriptsOf = (
  document: EmbeddedDocument,
  rawContent: string,
  originFileName: string,
): readonly EmbeddedScript[] =>
  document.regions.flatMap((region, index) => {
    const program = programOf(region.scriptAst)
    if (program === undefined) {
      return []
    }
    const ast: ScriptAst = {
      format: 'js',
      root: program,
      comments: [],
      rawContent: rawContent.slice(region.start, region.end),
      originFileName,
    }
    return [{ region: index, ast }]
  })

const embeddedOf = (ast: Ast): EmbeddedAst => {
  if (ast.format !== 'embedded') {
    throw new Error(`Expected an embedded document AST, received the "${ast.format}" format`)
  }
  return ast
}

export const frameworkEntryOf = (moduleName: string, service: FrameworkService): EmbeddedFormatEntry => ({
  claim: {
    formatId: formatIdOf(service.claim.formatId),
    extensions: [...service.claim.extensions],
    language: service.claim.language,
    kind: 'embedded',
  },
  owner: moduleName,
  parse: async (text: string, fileName: string, _context: ParserContext): Promise<EmbeddedAst> => {
    await frameworkToolkit()
    const document = await Effect.runPromise(service.parse(text, frameworkContextOf()))
    return {
      format: 'embedded',
      formatId: formatIdOf(document.formatId),
      originFileName: fileName,
      rawContent: text,
      document: { ...document, formatId: formatIdOf(document.formatId) },
      scripts: embeddedScriptsOf(document, text, fileName),
    }
  },
  transform: async (
    ast: Ast,
    mutantCollector: MutantCollector,
    context: TransformerContext,
  ): Promise<readonly string[]> => {
    const embedded = embeddedOf(ast)
    const warnings: string[] = []
    for (const script of embedded.scripts) {
      warnings.push(...await transform(script.ast, mutantCollector, context))
    }
    await Effect.runPromise(service.transform(embedded.document, frameworkContextOf()))
    return warnings
  },
  print: (ast: Ast, _context: PrinterContext): string => {
    const embedded = embeddedOf(ast)
    return Effect.runSync(service.print(embedded.document, frameworkContextOf()))
  },
  disableTypeChecks: (ast: Ast): string => {
    const embedded = embeddedOf(ast)
    return Effect.runSync(service.disableTypeChecks(embedded.rawContent))
  },
})
