/**
 * Parser — all parsers that turn source text into the instrumenter's ASTs.
 */
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { OxcError } from 'oxc-parser'
import path from 'path'
import { buildLineTable, positionFromLineTable, type Program } from './Ast.js'
import type { FormatEntry, FormatRegistry, ScriptFormatEntry } from './format-registry.js'
import { loadOxc } from './Oxc.js'
import { ParseFailed, ParserNotFound } from './Parser.schema.js'
import { FormatAssigned, type FormatResolutionDecision } from './resolve-format.workflow.js'
import {
  type Ast,
  type JSAst,
  type ScriptAst,
  type ScriptFormat,
  type SpannedComment,
  type TSAst,
  type TsxAst,
} from './Syntax.js'

export interface ParserOptions {}

export interface ParserContext {
  parse: (code: string, fileName: string, scriptFormat: ScriptFormat) => Promise<ScriptAst>
}

export type Parser<T extends Ast = Ast> = (
  text: string,
  fileName: string,
  context: ParserContext,
) => Promise<T>
// ---------------------------------------------------------------------------
// Oxc parse — one engine for js, ts and tsx.
// ---------------------------------------------------------------------------

export async function parseWithOxc(
  text: string,
  fileName: string,
  lang: 'js' | 'jsx' | 'ts' | 'tsx',
): Promise<{ root: Program; comments: readonly SpannedComment[] }> {
  const { parseSync } = await loadOxc()
  const result = parseSync(fileName, text, { lang, range: true })
  const failure = oxcParseFailure(result.errors, text, fileName)
  if (failure !== undefined) {
    throw failure
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = result.program as unknown as Program
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion typescript/no-unsafe-type-assertion
  return { root: program, comments: result.comments as readonly SpannedComment[] }
}

function oxcParseFailure(
  errors: readonly OxcError[],
  text: string,
  fileName: string,
): ParseFailed | undefined {
  const first = errors.at(0)
  if (first === undefined) {
    return undefined
  }
  return new ParseFailed({
    fileName,
    message: first.message,
    location: positionFromLineTable(oxcErrorLabelStart(first), buildLineTable(text)),
    cause: errors.map((reported) => reported.message),
  })
}

function oxcErrorLabelStart(error: OxcError): number {
  const label = error.labels.at(0)
  if (label === undefined) {
    return 0
  }
  return label.start
}
// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

type ParseFn = {
  (code: string, fileName: string, formatOverride: ScriptFormat): Promise<ScriptAst>
  (code: string, fileName: string, formatOverride?: ScriptFormat): Promise<Ast>
}

const notFound = (fileName: string, extension: string): ParserNotFound =>
  new ParserNotFound({ fileName, extension, cause: undefined })

const entryOf = (registry: FormatRegistry, fileName: string, formatId: string): FormatEntry =>
  Option.match(registry.entryForFormat(formatId), {
    onNone: () => {
      throw notFound(fileName, formatId)
    },
    onSome: (entry) => entry,
  })

const scriptEntryOf = (entry: FormatEntry): ScriptFormatEntry =>
  'scriptFormat' in entry ? entry : rejectNonScriptEntry(entry)

function rejectNonScriptEntry(entry: FormatEntry): never {
  throw new Error(`Format "${entry.claim.formatId}" is not a script format`)
}

const entryForDecision = (
  registry: FormatRegistry,
  fileName: string,
  decision: FormatResolutionDecision,
): FormatEntry =>
  Match.value(decision).pipe(
    Match.when(S.is(FormatAssigned), (assigned) => entryOf(registry, fileName, assigned.formatId)),
    Match.orElse(() => {
      throw notFound(fileName, path.extname(fileName).toLowerCase())
    }),
  )

const assignedEntry = (
  registry: FormatRegistry,
  resolution: Result.Result<FormatResolutionDecision, unknown>,
  fileName: string,
): FormatEntry =>
  Match.value(resolution).pipe(
    Match.when(Result.isSuccess, (resolved) => entryForDecision(registry, fileName, resolved.success)),
    Match.orElse(() => {
      throw notFound(fileName, path.extname(fileName).toLowerCase())
    }),
  )

async function parseByRegistry(
  registry: FormatRegistry,
  context: ParserContext,
  code: string,
  fileName: string,
  scriptFormat: ScriptFormat,
): Promise<ScriptAst> {
  const entry = scriptEntryOf(assignedEntry(registry, registry.resolve(fileName, scriptFormat), fileName))
  const ast = await entry.parse(code, fileName, context)
  return isScriptAst(ast) ? ast : rejectNonScriptAst(ast)
}

const SCRIPT_FORMATS: readonly ScriptFormat[] = ['js', 'ts', 'tsx']

const isScriptAst = (ast: Ast): ast is ScriptAst => (SCRIPT_FORMATS as readonly string[]).includes(ast.format)

function rejectNonScriptAst(ast: Ast): never {
  throw new Error(`Expected a script AST, received the "${ast.format}" format`)
}

async function parseFile(
  registry: FormatRegistry,
  context: ParserContext,
  code: string,
  fileName: string,
  formatOverride?: ScriptFormat,
): Promise<Ast> {
  return assignedEntry(registry, registry.resolve(fileName, formatOverride), fileName).parse(
    code,
    fileName,
    context,
  )
}

export function createParser(registry: FormatRegistry): ParseFn {
  const context: ParserContext = {
    parse: (code, fileName, scriptFormat) => parseByRegistry(registry, context, code, fileName, scriptFormat),
  }
  function parse(code: string, fileName: string, formatOverride: ScriptFormat): Promise<ScriptAst>
  function parse(code: string, fileName: string, formatOverride?: ScriptFormat): Promise<Ast>
  function parse(code: string, fileName: string, formatOverride?: ScriptFormat): Promise<Ast> {
    return parseFile(registry, context, code, fileName, formatOverride)
  }
  return parse
}

// ---------------------------------------------------------------------------
// JS parser
// ---------------------------------------------------------------------------
export async function parseJS(text: string, fileName: string): Promise<JSAst> {
  const { root, comments } = await parseWithOxc(text, fileName, 'js')
  return { originFileName: fileName, rawContent: text, format: 'js', root, comments }
}

// ---------------------------------------------------------------------------
// TS / TSX parsers
// ---------------------------------------------------------------------------

export async function parseTS(text: string, fileName: string): Promise<TSAst> {
  const { root, comments } = await parseWithOxc(text, fileName, 'ts')
  return { originFileName: fileName, rawContent: text, format: 'ts', root, comments }
}

export async function parseTsx(
  text: string,
  fileName: string,
): Promise<TsxAst> {
  const { root, comments } = await parseWithOxc(text, fileName, 'tsx')
  return { root, comments, format: 'tsx', originFileName: fileName, rawContent: text }
}
