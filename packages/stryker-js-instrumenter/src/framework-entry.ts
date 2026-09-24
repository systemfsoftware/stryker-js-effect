import type {
  EmbeddedDocument,
  Framework,
  FrameworkContext,
  FrameworkParseResult,
  ScriptFormat,
} from '@systemfsoftware/stryker-framework-interface'
import * as Effect from 'effect/Effect'
import { type Program, type Statement } from './Ast.js'
import type { EmbeddedFormatEntry, FormatClaim } from './format-registry.js'
import { instrumentationHeader } from './instrument-header.js'
import { InstrumentError } from './Instrument.schema.js'
import type { Position } from './Location.schema.js'
import { errorToString } from './Mutant.js'
import { loadOxc, type Oxc } from './Oxc.js'
import { ParseFailed } from './Parser.schema.js'
import { printProgram } from './print/index.js'
import {
  type Ast,
  computeLineStarts,
  type EmbeddedAst,
  type EmbeddedScript,
  positionFromOffset,
  type ScriptAst,
} from './Syntax.js'

/**
 * Lift the 0-based region origin into the 1-based file coordinates the
 * plan-mutants shift speaks: the region starts on 1-based line `line + 1`,
 * and a region that opens mid-line carries its 0-based column as the shift
 * added only to the region's first line.
 */
const toOneBasedOrigin = (origin: Position): Position => ({ line: origin.line + 1, column: origin.column })

const EMBEDDED_SCRIPT_FILE = 'embedded-script.js'

interface FrameworkToolkit {
  readonly parseScript: (source: string, scriptFormat: ScriptFormat) => Program
  readonly header: readonly Statement[]
}

const loadFrameworkToolkit: Effect.Effect<FrameworkToolkit, ParseFailed> = Effect.gen(function*() {
  const oxc = yield* loadOxc
  const header = yield* instrumentationHeader
  return {
    parseScript: (source, scriptFormat) => parseScriptProgram(oxc, source, scriptFormat),
    header,
  }
})

const parseScriptProgram = (
  oxc: Oxc,
  source: string,
  scriptFormat: ScriptFormat,
): Program => {
  const result = oxc.parseSync(EMBEDDED_SCRIPT_FILE, source, { lang: scriptFormat, range: true })
  const first = result.errors.at(0)
  if (first !== undefined) {
    throw ParseFailed.make({
      fileName: EMBEDDED_SCRIPT_FILE,
      message: first.message,
      location: { line: 0, column: 0 },
      cause: first,
    })
  }
  return result.program
}

const frameworkContextOf = (toolkit: FrameworkToolkit): FrameworkContext => ({
  parseScript: toolkit.parseScript,
  printScript: (script) => printProgram(script, { hashbang: null }),
  instrumentationHeader: () => toolkit.header,
})

const embeddedScriptsOf = (
  document: EmbeddedDocument,
  rawContent: string,
  originFileName: string,
): readonly EmbeddedScript[] => {
  const lineStarts = computeLineStarts(rawContent)
  return document.regions.flatMap((region, index) => {
    const ast: ScriptAst = {
      format: 'js',
      root: region.scriptAst,
      comments: [],
      rawContent: rawContent.slice(region.start, region.end),
      originFileName,
      offset: toOneBasedOrigin(positionFromOffset(lineStarts, region.start)),
    }
    return [{ region: index, ast }]
  })
}

const embeddedOf = (ast: Ast): EmbeddedAst => {
  if (ast.format !== 'embedded') {
    throw new Error(`Expected an embedded document AST, received the "${ast.format}" format`)
  }
  return ast
}

const frameworkFailure = (moduleName: string, fileName: string, detail: string): InstrumentError =>
  InstrumentError.make({
    message: `The framework "${moduleName}" could not parse ${fileName}: ${detail}`,
    cause: new Error(detail),
  })

const hookFailure = <A = unknown>(moduleName: string, hook: string, fileName: string, cause: A): InstrumentError =>
  InstrumentError.make({
    message: `The framework "${moduleName}" threw while running ${hook} for ${fileName}: ${errorToString(cause)}`,
    cause,
  })

const runHook = <A>(
  moduleName: string,
  hook: string,
  fileName: string,
  run: () => A,
): Effect.Effect<A, InstrumentError> =>
  Effect.try({ try: run, catch: (cause) => hookFailure(moduleName, hook, fileName, cause) })

const settled = <A>(
  moduleName: string,
  fileName: string,
  result: FrameworkParseResult<A>,
): Effect.Effect<A, InstrumentError> =>
  result.kind === 'Parsed'
    ? Effect.succeed(result.value)
    : Effect.fail(frameworkFailure(moduleName, fileName, result.message))

export const frameworkEntryOf = (moduleName: string, framework: Framework): EmbeddedFormatEntry => ({
  claim: {
    formatId: framework.claim.formatId,
    extensions: [...framework.claim.extensions],
    language: framework.claim.language,
    kind: 'embedded',
  } satisfies FormatClaim<'embedded'>,
  owner: moduleName,
  ownerVersion: framework.claim.ownerVersion,
  parse: (text, fileName) =>
    Effect.gen(function*() {
      const context = frameworkContextOf(yield* loadFrameworkToolkit)
      const result = yield* runHook(moduleName, 'parse', fileName, () => framework.parse(text, context))
      const document = yield* settled(moduleName, fileName, result)
      return {
        format: 'embedded',
        formatId: framework.claim.formatId,
        originFileName: fileName,
        rawContent: text,
        document,
        context,
        scripts: embeddedScriptsOf(document, text, fileName),
      } satisfies EmbeddedAst
    }),
  transform: (ast, mutantCollector, context) =>
    Effect.gen(function*() {
      const embedded = embeddedOf(ast)
      const warnings = yield* Effect.forEach(
        embedded.scripts,
        (script) => context.transform(script.ast, mutantCollector, context),
      )
      embedded.document = yield* runHook(
        moduleName,
        'transform',
        embedded.originFileName,
        () => framework.transform(embedded.document, embedded.context),
      )
      return warnings.flat()
    }),
  print: (ast) => {
    const embedded = embeddedOf(ast)
    return framework.print(embedded.document, embedded.context)
  },
  disableTypeChecks: (ast) => {
    const embedded = embeddedOf(ast)
    return runHook(
      moduleName,
      'disableTypeChecks',
      embedded.originFileName,
      () => framework.disableTypeChecks(embedded.rawContent),
    ).pipe(Effect.flatMap((result) => settled(moduleName, embedded.originFileName, result)))
  },
})
