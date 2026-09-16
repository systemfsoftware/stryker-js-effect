import type { FormatId } from '@systemfsoftware/stryker-framework-interface'
import * as Option from 'effect/Option'
import type { Result } from 'effect/Result'
import path from 'path'

import { parseHtml, parseJS, type ParserContext, parseSvelte, parseTS, parseTsx } from './Parser.js'
import { htmlPrint, jsPrint, type PrinterContext, sveltePrint, tsPrint } from './Printer.js'
import {
  type FormatOverrideUnclaimed,
  FormatResolutionCommand,
  type FormatResolutionDecision,
  resolveFormat,
} from './resolve-format.workflow.js'
import {
  type Ast,
  type HtmlAst,
  type JSAst,
  type ScriptAst,
  type ScriptFormat,
  type SvelteAst,
  type TSAst,
  type TsxAst,
} from './Syntax.js'
import type { AstTransformer } from './Transformer.js'
import { transformHtml, transformScript, transformSvelte } from './Transformer.js'
import {
  disableTypeCheckingInHtml,
  disableTypeCheckingInScript,
  disableTypeCheckingInSvelte,
} from './type-check-disablers.js'

export type FormatKind = 'script' | 'embedded'

export interface FormatClaim<Kind extends FormatKind = FormatKind> {
  readonly formatId: FormatId
  readonly extensions: readonly string[]
  readonly language: string
  readonly kind: Kind
}

export interface FormatHooks {
  readonly owner: string
  readonly parse: (text: string, fileName: string, context: ParserContext) => Promise<Ast>
  readonly transform: AstTransformer
  readonly print: (ast: Ast, context: PrinterContext) => string
  readonly disableTypeChecks: (ast: Ast) => string
}

export interface ScriptFormatEntry extends FormatHooks {
  readonly claim: FormatClaim<'script'>
  readonly scriptFormat: ScriptFormat
}

export interface EmbeddedFormatEntry extends FormatHooks {
  readonly claim: FormatClaim<'embedded'>
}

export type FormatEntry = ScriptFormatEntry | EmbeddedFormatEntry

export interface FormatRegistry {
  readonly entries: readonly FormatEntry[]
  readonly entryForFormat: (formatId: string) => Option.Option<FormatEntry>
  readonly entryForExtension: (extension: string) => Option.Option<FormatEntry>
  readonly resolutionCommand: (fileName: string, formatIdOverride?: string) => FormatResolutionCommand
  readonly resolve: (
    fileName: string,
    formatIdOverride?: string,
  ) => Result<FormatResolutionDecision, FormatOverrideUnclaimed>
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const formatIdOf = (id: string): FormatId => id as FormatId

const SCRIPT_FORMATS: ReadonlyArray<Ast['format']> = ['js', 'ts', 'tsx']

const isScriptAst = (ast: Ast): ast is ScriptAst => SCRIPT_FORMATS.includes(ast.format)

export const requireScriptAst = (ast: Ast): ScriptAst => (isScriptAst(ast) ? ast : rejectAst(ast, 'a script'))

const requireJsAst = (ast: Ast): JSAst => (ast.format === 'js' ? ast : rejectAst(ast, 'a js script'))

const TS_FAMILY_FORMATS: readonly Ast['format'][] = ['ts', 'tsx']

const isTsFamilyAst = (ast: Ast): ast is TSAst | TsxAst => (TS_FAMILY_FORMATS as readonly string[]).includes(ast.format)

const requireTsFamilyAst = (ast: Ast): TSAst | TsxAst => (isTsFamilyAst(ast) ? ast : rejectAst(ast, 'a ts script'))

const requireHtmlAst = (ast: Ast): HtmlAst => (ast.format === 'html' ? ast : rejectAst(ast, 'an html'))

const requireSvelteAst = (ast: Ast): SvelteAst => (ast.format === 'svelte' ? ast : rejectAst(ast, 'a svelte'))

function rejectAst(ast: Ast, expected: string): never {
  throw new Error(`Expected ${expected} AST, received the "${ast.format}" format`)
}

export const extensionOf = (fileName: string): string => path.extname(fileName).toLowerCase()

const CORE_OWNER = '@systemfsoftware/stryker-js-instrumenter'

export const formatRegistry = (entries: readonly FormatEntry[]): FormatRegistry => {
  const entryForFormat = (formatId: string): Option.Option<FormatEntry> =>
    Option.fromUndefinedOr(entryWithFormat(entries, formatId))
  const entryForExtension = (extension: string): Option.Option<FormatEntry> =>
    Option.fromUndefinedOr(entryWithExtension(entries, extension))
  const resolutionCommand = (fileName: string, formatIdOverride?: string): FormatResolutionCommand =>
    new FormatResolutionCommand({
      fileName,
      extension: extensionOf(fileName),
      formatId: formatIdOverride,
      claims: entries.map((entry) => entry.claim),
    })
  return {
    entries,
    entryForFormat,
    entryForExtension,
    resolutionCommand,
    resolve: (fileName: string, formatIdOverride?: string) =>
      resolveFormat(resolutionCommand(fileName, formatIdOverride)),
  }
}

const entryWithFormat = (entries: readonly FormatEntry[], formatId: string): FormatEntry | undefined =>
  entries.find((entry) => entry.claim.formatId === formatId)

const entryWithExtension = (entries: readonly FormatEntry[], extension: string): FormatEntry | undefined =>
  entries.find((entry) => entry.claim.extensions.includes(extension))

export const registerEntries = (registry: FormatRegistry, additions: readonly FormatEntry[]): FormatRegistry =>
  formatRegistry([...registry.entries, ...additions])

const SCRIPT_ENTRIES: readonly ScriptFormatEntry[] = [
  {
    claim: {
      formatId: formatIdOf('js'),
      extensions: ['.js', '.jsx', '.mjs', '.cjs'],
      language: 'javascript',
      kind: 'script',
    },
    scriptFormat: 'js',
    owner: CORE_OWNER,
    parse: parseJS,
    transform: (ast, mutantCollector, context) => transformScript(requireScriptAst(ast), mutantCollector, context),
    print: (ast, context) => jsPrint(requireJsAst(ast), context),
    disableTypeChecks: (ast) => disableTypeCheckingInScript(requireScriptAst(ast)),
  },
  {
    claim: {
      formatId: formatIdOf('ts'),
      extensions: ['.ts', '.mts', '.cts'],
      language: 'typescript',
      kind: 'script',
    },
    scriptFormat: 'ts',
    owner: CORE_OWNER,
    parse: parseTS,
    transform: (ast, mutantCollector, context) => transformScript(requireScriptAst(ast), mutantCollector, context),
    print: (ast, context) => tsPrint(requireTsFamilyAst(ast), context),
    disableTypeChecks: (ast) => disableTypeCheckingInScript(requireScriptAst(ast)),
  },
  {
    claim: { formatId: formatIdOf('tsx'), extensions: ['.tsx'], language: 'typescript', kind: 'script' },
    scriptFormat: 'tsx',
    owner: CORE_OWNER,
    parse: parseTsx,
    transform: (ast, mutantCollector, context) => transformScript(requireScriptAst(ast), mutantCollector, context),
    print: (ast, context) => tsPrint(requireTsFamilyAst(ast), context),
    disableTypeChecks: (ast) => disableTypeCheckingInScript(requireScriptAst(ast)),
  },
]

const EMBEDDED_ENTRIES: readonly EmbeddedFormatEntry[] = [
  {
    claim: {
      formatId: formatIdOf('html'),
      extensions: ['.html', '.htm', '.vue'],
      language: 'html',
      kind: 'embedded',
    },
    owner: CORE_OWNER,
    parse: parseHtml,
    transform: (ast, mutantCollector, context) => transformHtml(requireHtmlAst(ast), mutantCollector, context),
    print: (ast, context) => htmlPrint(requireHtmlAst(ast), context),
    disableTypeChecks: (ast) => disableTypeCheckingInHtml(requireHtmlAst(ast)),
  },
  {
    claim: { formatId: formatIdOf('svelte'), extensions: ['.svelte'], language: 'svelte', kind: 'embedded' },
    owner: CORE_OWNER,
    parse: parseSvelte,
    transform: (ast, mutantCollector, context) => transformSvelte(requireSvelteAst(ast), mutantCollector, context),
    print: (ast, context) => sveltePrint(requireSvelteAst(ast), context),
    disableTypeChecks: (ast) => disableTypeCheckingInSvelte(requireSvelteAst(ast)),
  },
]

export const coreFormatRegistry: FormatRegistry = formatRegistry([...SCRIPT_ENTRIES, ...EMBEDDED_ENTRIES])
