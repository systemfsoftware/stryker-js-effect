import type { FormatId } from '@systemfsoftware/stryker-framework-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { InstrumentError } from './Instrument.schema.js'
import { createParser, parseJS, type ParserContext, parseTS, parseTsx } from './Parser.js'
import type { ParseFailed } from './Parser.schema.js'
import { jsPrint, type PrinterContext, tsPrint } from './Printer.js'
import { FormatResolutionCommand, resolveFormat } from './resolve-format.workflow.js'
import { type Ast, type JSAst, type ScriptAst, type ScriptFormat, type TSAst, type TsxAst } from './Syntax.js'
import { type AstTransformer, transformScript } from './Transformer.js'
import { disableTypeCheckingInScript } from './type-check-disablers.js'

export type FormatKind = 'script' | 'embedded'

export interface FormatClaim<Kind extends FormatKind = FormatKind> {
  readonly formatId: FormatId
  readonly extensions: readonly string[]
  readonly language: string
  readonly kind: Kind
}

export interface ScriptHooks {
  readonly parse: (
    text: string,
    fileName: string,
    context: ParserContext,
  ) => Effect.Effect<Ast, ParseFailed | InstrumentError>
  readonly transform: AstTransformer
  readonly print: (ast: Ast, context: PrinterContext) => string
  readonly disableTypeChecks: (ast: Ast) => Effect.Effect<string, InstrumentError>
}

export interface FormatHooks extends ScriptHooks {
  readonly owner: string
  readonly ownerVersion: string
}

export interface ScriptFormatEntry extends FormatHooks {
  readonly claim: FormatClaim<'script'>
  readonly scriptFormat: ScriptFormat
}

export interface EmbeddedFormatEntry extends FormatHooks {
  readonly claim: FormatClaim<'embedded'>
}

export type FormatEntry = ScriptFormatEntry | EmbeddedFormatEntry

export type EntryForFormat = (formatId: string) => Option.Option<FormatEntry>

export interface FormatRegistry {
  readonly entries: readonly FormatEntry[]
  readonly entryForFormat: EntryForFormat
  readonly entryForExtension: (extension: string) => Option.Option<FormatEntry>
}
const requireScriptAst = (ast: Ast): ScriptAst => {
  if (ast.format === 'embedded') {
    return rejectAst(ast, 'a script')
  }
  return ast
}

const requireJsAst = (ast: Ast): JSAst => (ast.format === 'js' ? ast : rejectAst(ast, 'a js script'))

const requireTsFamilyAst = (ast: Ast): TSAst | TsxAst =>
  Match.value(ast).pipe(
    Match.when({ format: 'ts' }, (ts) => ts),
    Match.when({ format: 'tsx' }, (tsx) => tsx),
    Match.orElse((other) => rejectAst(other, 'a ts script')),
  )

function rejectAst(ast: Ast, expected: string): never {
  throw new Error(`Expected ${expected} AST, received the "${ast.format}" format`)
}

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  return dot > slash ? fileName.slice(dot).toLowerCase() : extensionlessFile(dot, slash)
}

const extensionlessFile = (_dot: number, _slash: number): string => ''

const CORE_OWNER = '@systemfsoftware/stryker-js-instrumenter'
const CORE_OWNER_VERSION = 'builtin'

export const formatRegistry = (entries: readonly FormatEntry[]): FormatRegistry => {
  const entryForFormat = (formatId: string): Option.Option<FormatEntry> =>
    Option.fromUndefinedOr(entries.find((entry) => entry.claim.formatId === formatId))
  const entryForExtension = (extension: string): Option.Option<FormatEntry> =>
    Option.fromUndefinedOr(entries.find((entry) => entry.claim.extensions.includes(extension)))
  return {
    entries,
    entryForFormat,
    entryForExtension,
  }
}

export const registerEntries = (registry: FormatRegistry, additions: readonly FormatEntry[]): FormatRegistry =>
  formatRegistry([...registry.entries, ...additions])

export const parseWithEntry = (
  entry: FormatEntry,
  file: { readonly name: string; readonly content: string },
): Effect.Effect<Ast, InstrumentError> =>
  entry.parse(file.content, file.name, createParser()).pipe(
    Effect.catchTag('ParseFailed', (cause) => Effect.fail(InstrumentError.make({ message: cause.message, cause }))),
  )

export const resolutionCommandOf = (
  registry: FormatRegistry,
  fileName: string,
  formatIdOverride?: string,
): FormatResolutionCommand =>
  new FormatResolutionCommand({
    fileName,
    extension: extensionOf(fileName),
    formatId: formatIdOverride,
    claims: registry.entries.map((entry) => entry.claim),
  })

const scriptHooks = (
  scriptFormat: ScriptFormat,
): Pick<ScriptFormatEntry, 'parse' | 'transform' | 'print' | 'disableTypeChecks'> => ({
  parse: (text, fileName, _context) => parseScriptFormat(scriptFormat, text, fileName),
  transform: (ast, mutantCollector, context) => transformScript(requireScriptAst(ast), mutantCollector, context),
  print: (ast, context) => printScriptAst(ast, context),
  disableTypeChecks: (ast) => Effect.succeed(disableTypeCheckingInScript(requireScriptAst(ast))),
})

const parseScriptFormat = (
  scriptFormat: ScriptFormat,
  text: string,
  fileName: string,
): Effect.Effect<Ast, ParseFailed | InstrumentError> =>
  scriptFormat === 'tsx' ? parseTsx(text, fileName) : parseJsOrTs(scriptFormat, text, fileName)

const parseJsOrTs = (
  scriptFormat: ScriptFormat,
  text: string,
  fileName: string,
): Effect.Effect<Ast, ParseFailed | InstrumentError> =>
  scriptFormat === 'js' ? parseJS(text, fileName) : parseTS(text, fileName)

const printScriptAst = (ast: Ast, context: PrinterContext): string =>
  ast.format === 'js' ? jsPrint(requireJsAst(ast), context) : tsPrint(requireTsFamilyAst(ast), context)

const SCRIPT_ENTRIES: readonly ScriptFormatEntry[] = [
  {
    claim: { formatId: 'js', extensions: ['.js', '.jsx', '.mjs', '.cjs'], language: 'javascript', kind: 'script' },
    scriptFormat: 'js',
    owner: CORE_OWNER,
    ownerVersion: CORE_OWNER_VERSION,
    ...scriptHooks('js'),
  },
  {
    claim: { formatId: 'ts', extensions: ['.ts', '.mts', '.cts'], language: 'typescript', kind: 'script' },
    scriptFormat: 'ts',
    owner: CORE_OWNER,
    ownerVersion: CORE_OWNER_VERSION,
    ...scriptHooks('ts'),
  },
  {
    claim: { formatId: 'tsx', extensions: ['.tsx'], language: 'typescript', kind: 'script' },
    scriptFormat: 'tsx',
    owner: CORE_OWNER,
    ownerVersion: CORE_OWNER_VERSION,
    ...scriptHooks('tsx'),
  },
]

export const coreFormatRegistry: FormatRegistry = formatRegistry(SCRIPT_ENTRIES)

export const resolveFile = (registry: FormatRegistry, fileName: string, formatIdOverride?: string) =>
  resolveFormat(resolutionCommandOf(registry, fileName, formatIdOverride))
