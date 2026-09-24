import type { Hashbang as OxcHashbang } from '@oxc-project/types'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import { formatKeyOf } from './Ast.handle.js'
import { type Ast, type AstRoot, type JSAst, type TSAst, type TsxAst } from './Ast.schema.js'
import type { EntryForFormat, FormatEntry } from './Format.schema.js'
import { type Hashbang, printProgram } from './print/SourceText.handle.js'

export type Printer<T extends Ast = Ast> = (file: T, context: PrinterContext) => string

export interface PrinterContext {
  print: Printer<Ast>
}

function printDataFirst(file: Ast, entryForFormat: EntryForFormat): string {
  const context: PrinterContext = { print: (inner) => print(inner, entryForFormat) }
  return Option.match(entryForFormat(formatKeyOf(file)), {
    onNone: () => missingFormatPrint(file),
    onSome: (entry: FormatEntry) => entry.print(file, context),
  })
}

export const print: {
  (file: Ast, entryForFormat: EntryForFormat): string
  (entryForFormat: EntryForFormat): (file: Ast) => string
} = dual((args: IArguments): boolean => args.length >= 2, printDataFirst)

function missingFormatPrint(file: Ast): never {
  throw new Error(`No registered format renders the "${formatKeyOf(file)}" AST`)
}

const hashbangOf = (root: AstRoot): Hashbang | null => Predicate.isObject(root) ? hashbangField(root) : null

const hashbangField = (root: object): Hashbang | null => hasHashbangProp(root) ? narrowHashbang(root) : null

const hasHashbangProp = (value: object): value is { readonly hashbang: OxcHashbang | null } =>
  Predicate.hasProperty(value, 'hashbang')

const narrowHashbang = (root: { readonly hashbang: OxcHashbang | null }): Hashbang | null =>
  isNarrowHashbang(root.hashbang) ? printHashbang(root.hashbang) : null

const isNarrowHashbang = (field: OxcHashbang | null): field is OxcHashbang => Predicate.isObject(field)

const printHashbang = (field: OxcHashbang): Hashbang => ({
  type: 'Hashbang',
  value: hashbangValue(field),
  start: field.start,
})

const hashbangValue = (field: OxcHashbang): string => (typeof field.value === 'string' ? field.value : '')

const jsPrintDataFirst: Printer<JSAst> = (file) => printProgram(file.root, { hashbang: hashbangOf(file.root) })

export const jsPrint: {
  (file: JSAst, context: PrinterContext): string
  (context: PrinterContext): (file: JSAst) => string
} = dual((args: IArguments): boolean => args.length >= 2, jsPrintDataFirst)

const tsPrintDataFirst: Printer<TSAst | TsxAst> = (file) => printProgram(file.root, { hashbang: hashbangOf(file.root) })

export const tsPrint: {
  (file: TSAst | TsxAst, context: PrinterContext): string
  (context: PrinterContext): (file: TSAst | TsxAst) => string
} = dual((args: IArguments): boolean => args.length >= 2, tsPrintDataFirst)
