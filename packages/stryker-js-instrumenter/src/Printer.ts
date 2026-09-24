import type { Hashbang as OxcHashbang } from '@oxc-project/types'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type { EntryForFormat, FormatEntry } from './format-registry.js'
import { type Hashbang, printProgram } from './print/index.js'
import { type Ast, type AstRoot, formatKeyOf, type JSAst, type TSAst, type TsxAst } from './Syntax.js'

export type Printer<T extends Ast = Ast> = (file: T, context: PrinterContext) => string

export interface PrinterContext {
  print: Printer<Ast>
}

export function print(file: Ast, entryForFormat: EntryForFormat): string {
  const context: PrinterContext = { print: (inner) => print(inner, entryForFormat) }
  return Option.match(entryForFormat(formatKeyOf(file)), {
    onNone: () => missingFormatPrint(file),
    onSome: (entry: FormatEntry) => entry.print(file, context),
  })
}

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

export const jsPrint: Printer<JSAst> = (file) => printProgram(file.root, { hashbang: hashbangOf(file.root) })

export const tsPrint: Printer<TSAst | TsxAst> = (file) => printProgram(file.root, { hashbang: hashbangOf(file.root) })
