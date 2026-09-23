import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import { spanOf } from './Ast.handle.js'
import type { Ast, HtmlAst, JSAst, SvelteAst, TSAst, TemplateScript, TsxAst } from './Ast.schema.js'
import { PrintFailed } from './print/PrintFailed.schema.js'
import { type Hashbang, printProgram } from './print/index.js'

export type Printer<T extends Ast> = (file: T, context: PrinterContext) => Result.Result<string, PrintFailed>
export interface PrinterContext {
  print: Printer<Ast>
}
export const print = (file: Ast): Result.Result<string, PrintFailed> => {
  const context: PrinterContext = { print }
  return Match.value(file).pipe(
    Match.when({ format: 'js' }, (ast) => scriptPrint(ast)),
    Match.when({ format: 'ts' }, (ast) => scriptPrint(ast)),
    Match.when({ format: 'tsx' }, (ast) => scriptPrint(ast)),
    Match.when({ format: 'html' }, (ast) => htmlPrint(ast, context)),
    Match.when({ format: 'svelte' }, (ast) => sveltePrint(ast, context)),
    Match.exhaustive,
  )
}

const HASHBANG_FIELDS: Readonly<Record<string, <A = unknown>(field: A) => boolean>> = {
  type: (field) => field === 'Hashbang',
  value: (field) => typeof field === 'string',
  start: (field) => typeof field === 'number',
}

const isHashbang = (value: unknown): value is Hashbang =>
  Predicate.isObject(value) && Object.entries(HASHBANG_FIELDS).every(([key, accepts]) => accepts(value[key]))

const toHashbang = <A = unknown>(hashbang: A): Hashbang | null =>
  Option.match(Option.filter(Option.fromNullishOr(hashbang), isHashbang), {
    onSome: (value) => value,
    onNone: () => null,
  })

const hasHashbangField = (root: Ast['root']): root is Ast['root'] & { readonly hashbang?: Hashbang | null } =>
  'hashbang' in root

const getHashbang = (root: Ast['root']): Hashbang | null =>
  Option.match(
    Option.map(Option.filter(Option.some(root), hasHashbangField), (value) => toHashbang(value.hashbang)),
    {
      onNone: () => null,
      onSome: (hashbang) => hashbang,
    },
  )

const scriptPrint: Printer<JSAst | TSAst | TsxAst> = (file) =>
  Result.succeed(printProgram(file.root, { hashbang: getHashbang(file.root) }))

interface WrittenText {
  readonly text: string
  readonly cursor: number
}

interface SpannedScript {
  readonly script: HtmlAst['root']['scripts'][number]
  readonly start: number
  readonly end: number
}

const spannedScriptOf = (script: HtmlAst['root']['scripts'][number]): Result.Result<SpannedScript, PrintFailed> =>
  Option.match(Option.fromUndefinedOr(spanOf(script.root)), {
    onNone: () => Result.fail(PrintFailed.make({ message: 'Script AST root without start' })),
    onSome: (span) => Result.succeed({ script, start: span.start, end: span.end }),
  })

const spannedScriptsOf = (
  scripts: readonly HtmlAst['root']['scripts'][number][],
): Result.Result<ReadonlyArray<SpannedScript>, PrintFailed> =>
  Arr.reduce(scripts, Result.succeed<ReadonlyArray<SpannedScript>>([]), (state, script) =>
    Result.flatMap(state, (collected) =>
      Result.map(spannedScriptOf(script), (spanned) => [...collected, spanned]),
    ))

const htmlPrint: Printer<HtmlAst> = (ast, context) =>
  Result.flatMap(spannedScriptsOf(ast.root.scripts), (spanned) => {
    const sorted = [...spanned].sort((a, b) => a.start - b.start)
    return Result.map(
      Arr.reduce(sorted, Result.succeed({ text: '', cursor: 0 } satisfies WrittenText), (state, spannedScript) =>
        Result.flatMap(state, (current) =>
          Result.map(context.print(spannedScript.script, context), (code) => ({
            text: `${current.text}${ast.rawContent.substring(current.cursor, spannedScript.start)}\n${code}\n`,
            cursor: spannedScript.end,
          })),
        ),
      ),
      (written) => `${written.text}${ast.rawContent.substring(written.cursor)}`,
    )
  })

const sveltePrint: Printer<SvelteAst> = ({ root, rawContent }, context) => {
  const sortedScripts = [root.moduleScript, ...root.additionalScripts]
    .filter(Predicate.isNotNullish)
    .sort((a, b) => a.range.start - b.range.start)
  return Result.map(
    Arr.reduce(sortedScripts, Result.succeed({ text: '', cursor: 0 } satisfies WrittenText), (state, script) =>
      Result.flatMap(state, (current) => appendSvelteScript(current, script, rawContent, context)),
    ),
    (written) => `${written.text}${rawContent.substring(written.cursor)}`,
  )
}

const appendSvelteScript = (
  state: WrittenText,
  script: TemplateScript,
  rawContent: string,
  context: PrinterContext,
): Result.Result<WrittenText, PrintFailed> =>
  Result.map(context.print(script.ast, context), (code) =>
    Boolean.match(script.isExpression, {
      onTrue: () => ({
        text: `${state.text}${rawContent.substring(state.cursor, script.range.start)}${code.slice(0, -1)}`,
        cursor: script.range.end,
      }),
      onFalse: () => ({
        text: `${state.text}${rawContent.substring(state.cursor, script.range.start)}\n${code}\n`,
        cursor: script.range.end,
      }),
    }),
  )
