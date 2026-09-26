import type { Hashbang as OxcHashbang } from '@oxc-project/types'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import { formatKeyOf } from './Ast.handle.js'
import { type Ast, type AstRoot, type JSAst, type TSAst, type TsxAst } from './Ast.schema.js'
import type { EntryForFormat, FormatEntry } from './Format.schema.js'
import { PrintFailed } from './print/PrintFailed.schema.js'
import { type Hashbang, printProgram } from './print/SourceText.js'

export type Printer<T extends Ast = Ast> = (file: T, context: PrinterContext) => string

export interface PrinterContext {
  print: (file: Ast, context: PrinterContext) => Result.Result<string, PrintFailed>
}

function printDataFirst(file: Ast, entryForFormat: EntryForFormat): Result.Result<string, PrintFailed> {
  const context: PrinterContext = { print: (inner) => print(inner, entryForFormat) }
  return Option.match(entryForFormat(formatKeyOf(file)), {
    onNone: () =>
      Result.fail(
        PrintFailed.make({ message: `No registered format renders the "${formatKeyOf(file)}" AST` }),
      ),
    onSome: (entry: FormatEntry) => Result.succeed(entry.print(file, context)),
  })
}

export const print: {
  (file: Ast, entryForFormat: EntryForFormat): Result.Result<string, PrintFailed>
  (entryForFormat: EntryForFormat): (file: Ast) => Result.Result<string, PrintFailed>
} = dual((args: IArguments): boolean => args.length >= 2, printDataFirst)

const hashbangOf = (root: AstRoot): Hashbang | null => (hasHashbang(root) ? printHashbang(root.hashbang) : null)

const hasHashbang = (root: object): root is { readonly hashbang: OxcHashbang } =>
  Predicate.hasProperty(root, 'hashbang') && Predicate.isObject(root.hashbang)

const printHashbang = (field: OxcHashbang): Hashbang => ({
  type: 'Hashbang',
  value: hashbangValue(field),
  start: field.start,
})

const hashbangValue = (field: OxcHashbang): string => (typeof field.value === 'string' ? field.value : '')

const printScriptAst = (root: AstRoot): string => printProgram(root, { hashbang: hashbangOf(root) })

const jsPrintDataFirst: Printer<JSAst> = (file) => printScriptAst(file.root)

export const jsPrint: {
  (file: JSAst, context: PrinterContext): string
  (context: PrinterContext): (file: JSAst) => string
} = dual((args: IArguments): boolean => args.length >= 2, jsPrintDataFirst)

const tsPrintDataFirst: Printer<TSAst | TsxAst> = (file) => printScriptAst(file.root)

export const tsPrint: {
  (file: TSAst | TsxAst, context: PrinterContext): string
  (context: PrinterContext): (file: TSAst | TsxAst) => string
} = dual((args: IArguments): boolean => args.length >= 2, tsPrintDataFirst)
