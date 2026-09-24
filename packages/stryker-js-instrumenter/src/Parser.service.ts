import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import type * as OxcModule from 'oxc-parser'
import type { Program } from './Ast.handle.js'
import {
  type Ast,
  type JSAst,
  type ScriptAst,
  type ScriptFormat,
  type SpannedComment,
  type TSAst,
  type TsxAst,
} from './Ast.schema.js'
import { LineTable, LineTableFromText } from './Location.schema.js'
import { ParseFailed } from './Parser.schema.js'
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

type Oxc = typeof OxcModule
export type { Oxc }

const oxcModule = Effect.cached(Effect.promise(() => import('oxc-parser')))

export const loadOxc: Effect.Effect<Oxc> = Effect.flatMap(oxcModule, (load) => load)

const parseWithOxcDataFirst = (
  text: string,
  fileName: string,
  lang: 'js' | 'jsx' | 'ts' | 'tsx',
): Effect.Effect<{ root: Program; comments: readonly SpannedComment[] }, ParseFailed> =>
  Effect.gen(function*() {
    const oxc = yield* loadOxc
    const result = oxc.parseSync(fileName, text, { lang, range: true })
    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(text))
    const failure = oxcParseFailure(result.errors, fileName, lineTable)
    if (failure !== undefined) {
      return yield* failure
    }
    return { root: result.program, comments: result.comments }
  })

export const parseWithOxc: {
  (
    text: string,
    fileName: string,
    lang: 'js' | 'jsx' | 'ts' | 'tsx',
  ): Effect.Effect<{ root: Program; comments: readonly SpannedComment[] }, ParseFailed>
  (
    fileName: string,
    lang: 'js' | 'jsx' | 'ts' | 'tsx',
  ): (text: string) => Effect.Effect<{ root: Program; comments: readonly SpannedComment[] }, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 3, parseWithOxcDataFirst)

const oxcParseFailure = (
  errors: readonly OxcModule.OxcError[],
  fileName: string,
  lineTable: LineTable,
): ParseFailed | undefined => {
  const first = errors.at(0)
  if (first === undefined) {
    return undefined
  }
  return ParseFailed.make({
    fileName,
    message: first.message,
    location: lineTable.positionAt(oxcErrorLabelStart(first)),
    cause: errors.map((reported) => reported.message),
  })
}

const oxcErrorLabelStart = (error: OxcModule.OxcError): number => {
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

const parseJSDataFirst = (
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

export const parseJS: {
  (text: string, fileName: string): Effect.Effect<JSAst, ParseFailed>
  (fileName: string): (text: string) => Effect.Effect<JSAst, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 2, parseJSDataFirst)

const parseTSDataFirst = (
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

export const parseTS: {
  (text: string, fileName: string): Effect.Effect<TSAst, ParseFailed>
  (fileName: string): (text: string) => Effect.Effect<TSAst, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 2, parseTSDataFirst)

const parseTsxDataFirst = (
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

export const parseTsx: {
  (text: string, fileName: string): Effect.Effect<TsxAst, ParseFailed>
  (fileName: string): (text: string) => Effect.Effect<TsxAst, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 2, parseTsxDataFirst)
