import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { type Ast, type JSAst, type ScriptAst, type ScriptFormat, type TSAst, type TsxAst } from './Ast.schema.js'
import {
  type EmbeddedFormatEntry,
  type EntryForFormat,
  type FormatClaim,
  type FormatEntry,
  type FormatRegistry,
  type ScriptFormatEntry,
} from './Format.schema.js'
import { InstrumentError } from './Instrument.schema.js'
import type { ParseFailed } from './Parser.schema.js'
import { createParser, parseJS, parseTS, parseTsx } from './Parser.service.js'
import { jsPrint, type PrinterContext, tsPrint } from './Printer.handle.js'
import { FormatResolutionCommand, resolveFormat } from './resolve-format.workflow.js'
import { transformScript } from './Transformer.service.js'
import { disableTypeCheckingInScript } from './TypeCheckDisablers.handle.js'

export type { EmbeddedFormatEntry, EntryForFormat, FormatClaim, FormatEntry, FormatRegistry, ScriptFormatEntry }

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
  return dot > slash ? fileName.slice(dot).toLowerCase() : ''
}

const CORE_OWNER = '@systemfsoftware/stryker-js-instrumenter'
const CORE_OWNER_VERSION = 'builtin'

const formatRegistry = (entries: readonly FormatEntry[]): FormatRegistry => {
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

const registerEntriesDataFirst = (registry: FormatRegistry, additions: readonly FormatEntry[]): FormatRegistry =>
  formatRegistry([...registry.entries, ...additions])

export const registerEntries: {
  (registry: FormatRegistry, additions: readonly FormatEntry[]): FormatRegistry
  (additions: readonly FormatEntry[]): (registry: FormatRegistry) => FormatRegistry
} = dual((args: IArguments): boolean => args.length >= 2, registerEntriesDataFirst)

const parseWithEntryDataFirst = (
  entry: FormatEntry,
  file: { readonly name: string; readonly content: string },
): Effect.Effect<Ast, InstrumentError> =>
  entry.parse(file.content, file.name, createParser()).pipe(
    Effect.catchTag('ParseFailed', (cause) => Effect.fail(InstrumentError.make({ message: cause.message, cause }))),
  )

export const parseWithEntry: {
  (entry: FormatEntry, file: { readonly name: string; readonly content: string }): Effect.Effect<Ast, InstrumentError>
  (
    file: { readonly name: string; readonly content: string },
  ): (entry: FormatEntry) => Effect.Effect<Ast, InstrumentError>
} = dual((args: IArguments): boolean => args.length >= 2, parseWithEntryDataFirst)

const resolutionCommandOfDataFirst = (
  registry: FormatRegistry,
  fileName: string,
  formatIdOverride?: string,
): FormatResolutionCommand =>
  FormatResolutionCommand.make({
    fileName,
    extension: extensionOf(fileName),
    formatId: formatIdOverride,
    claims: registry.entries.map((entry) => entry.claim),
  })

export const resolutionCommandOf: {
  (registry: FormatRegistry, fileName: string, formatIdOverride?: string): FormatResolutionCommand
  (fileName: string, formatIdOverride?: string): (registry: FormatRegistry) => FormatResolutionCommand
} = dual((args: IArguments): boolean => typeof args[0] !== 'string', resolutionCommandOfDataFirst)

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
  Match.value(scriptFormat).pipe(
    Match.when('js', () => parseJS(text, fileName)),
    Match.when('ts', () => parseTS(text, fileName)),
    Match.when('tsx', () => parseTsx(text, fileName)),
    Match.exhaustive,
  )

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

const resolveFileDataFirst = (registry: FormatRegistry, fileName: string, formatIdOverride?: string) =>
  resolveFormat(resolutionCommandOf(registry, fileName, formatIdOverride))

export const resolveFile: {
  (registry: FormatRegistry, fileName: string, formatIdOverride?: string): ReturnType<typeof resolveFileDataFirst>
  (fileName: string, formatIdOverride?: string): (registry: FormatRegistry) => ReturnType<typeof resolveFileDataFirst>
} = dual((args: IArguments): boolean => typeof args[0] !== 'string', resolveFileDataFirst)
