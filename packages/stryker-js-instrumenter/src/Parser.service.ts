import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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

const parseWithOxcDataFirst = Effect.fn('stryker.instrument.parser.parseWithOxc')(
  function*(text: string, fileName: string, lang: 'js' | 'jsx' | 'ts' | 'tsx') {
    const oxc = yield* loadOxc
    const result = oxc.parseSync(fileName, text, { lang, range: true })
    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(text))
    const failure = oxcParseFailure(result.errors, fileName, lineTable)
    return yield* Option.match(Option.fromNullishOr(failure), {
      onNone: () => Effect.succeed({ root: result.program, comments: result.comments }),
      onSome: (failed) => Effect.fail(failed),
    })
  },
)

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
): ParseFailed | undefined =>
  Option.match(Option.fromNullishOr(errors.at(0)), {
    onNone: () => undefined,
    onSome: (first) =>
      ParseFailed.make({
        fileName,
        message: first.message,
        location: lineTable.positionAt(oxcErrorLabelStart(first)),
        cause: errors.map((reported) => reported.message),
      }),
  })

const oxcErrorLabelStart = (error: OxcModule.OxcError): number =>
  Option.getOrElse(Option.map(Option.fromNullishOr(error.labels.at(0)), (label) => label.start), () => 0)

export const createParser = (): ParserContext => ({
  parse: (code, fileName, scriptFormat) =>
    Match.value(scriptFormat).pipe(
      Match.when('js', () => parseJS(code, fileName)),
      Match.when('ts', () => parseTS(code, fileName)),
      Match.when('tsx', () => parseTsx(code, fileName)),
      Match.exhaustive,
    ),
})

const parseJSDataFirst = Effect.fn('stryker.instrument.parser.parseJS')(
  function*(text: string, fileName: string) {
    const parsed = yield* parseWithOxc(text, fileName, 'js')
    const ast: JSAst = {
      originFileName: fileName,
      rawContent: text,
      format: 'js',
      root: parsed.root,
      comments: parsed.comments,
    }
    return ast
  },
)

export const parseJS: {
  (text: string, fileName: string): Effect.Effect<JSAst, ParseFailed>
  (fileName: string): (text: string) => Effect.Effect<JSAst, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 2, parseJSDataFirst)

const parseTSDataFirst = Effect.fn('stryker.instrument.parser.parseTS')(
  function*(text: string, fileName: string) {
    const parsed = yield* parseWithOxc(text, fileName, 'ts')
    const ast: TSAst = {
      originFileName: fileName,
      rawContent: text,
      format: 'ts',
      root: parsed.root,
      comments: parsed.comments,
    }
    return ast
  },
)

export const parseTS: {
  (text: string, fileName: string): Effect.Effect<TSAst, ParseFailed>
  (fileName: string): (text: string) => Effect.Effect<TSAst, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 2, parseTSDataFirst)

const parseTsxDataFirst = Effect.fn('stryker.instrument.parser.parseTsx')(
  function*(text: string, fileName: string) {
    const parsed = yield* parseWithOxc(text, fileName, 'tsx')
    const ast: TsxAst = {
      root: parsed.root,
      comments: parsed.comments,
      format: 'tsx',
      originFileName: fileName,
      rawContent: text,
    }
    return ast
  },
)

export const parseTsx: {
  (text: string, fileName: string): Effect.Effect<TsxAst, ParseFailed>
  (fileName: string): (text: string) => Effect.Effect<TsxAst, ParseFailed>
} = dual((args: IArguments): boolean => args.length >= 2, parseTsxDataFirst)
