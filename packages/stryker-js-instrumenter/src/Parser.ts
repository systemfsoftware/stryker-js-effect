/**
 * Parser — all parsers that turn source text into the instrumenter's ASTs.
 */
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import type { OxcError } from 'oxc-parser'
import { buildLineTable, positionFromLineTable, type Program } from './Ast.js'
import { loadOxc } from './Oxc.js'
import { ParseFailed } from './Parser.schema.js'
import {
  type Ast,
  type JSAst,
  type ScriptAst,
  type ScriptFormat,
  type SpannedComment,
  type TSAst,
  type TsxAst,
} from './Syntax.js'
export { ParseFailed }

export interface ParserOptions {}

export interface ParserContext {
  parse: (code: string, fileName: string, scriptFormat: ScriptFormat) => Effect.Effect<ScriptAst, ParseFailed>
}

export type Parser<T extends Ast = Ast> = (
  text: string,
  fileName: string,
  context: ParserContext,
) => Effect.Effect<T, ParseFailed>

// ---------------------------------------------------------------------------
// Oxc parse — one engine for js, ts and tsx.
// ---------------------------------------------------------------------------

export const parseWithOxc = (
  text: string,
  fileName: string,
  lang: 'js' | 'jsx' | 'ts' | 'tsx',
): Effect.Effect<{ root: Program; comments: readonly SpannedComment[] }, ParseFailed> =>
  Effect.gen(function*() {
    const { parseSync } = yield* loadOxc
    const result = parseSync(fileName, text, { lang, range: true })
    const failure = oxcParseFailure(result.errors, text, fileName)
    if (failure !== undefined) {
      return yield* failure
    }
    return { root: result.program, comments: result.comments }
  })

function oxcParseFailure(
  errors: readonly OxcError[],
  text: string,
  fileName: string,
): ParseFailed | undefined {
  const first = errors.at(0)
  if (first === undefined) {
    return undefined
  }
  return ParseFailed.make({
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

export const createParser = (): ParserContext => ({
  parse: (code, fileName, scriptFormat) =>
    Match.value(scriptFormat).pipe(
      Match.when('js', () => parseJS(code, fileName)),
      Match.when('ts', () => parseTS(code, fileName)),
      Match.when('tsx', () => parseTsx(code, fileName)),
      Match.exhaustive,
    ),
})

export const parseJS = (
  text: string,
  fileName: string,
): Effect.Effect<JSAst, ParseFailed> =>
  Effect.map(parseWithOxc(text, fileName, 'js'), ({ root, comments }) => ({
    originFileName: fileName,
    rawContent: text,
    format: 'js',
    root,
    comments,
  }))

export const parseTS = (
  text: string,
  fileName: string,
): Effect.Effect<TSAst, ParseFailed> =>
  Effect.map(parseWithOxc(text, fileName, 'ts'), ({ root, comments }) => ({
    originFileName: fileName,
    rawContent: text,
    format: 'ts',
    root,
    comments,
  }))

export const parseTsx = (
  text: string,
  fileName: string,
): Effect.Effect<TsxAst, ParseFailed> =>
  Effect.map(parseWithOxc(text, fileName, 'tsx'), ({ root, comments }) => ({
    root,
    comments,
    format: 'tsx',
    originFileName: fileName,
    rawContent: text,
  }))
