import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type { FormatRegistry } from './format-registry.js'
import { type Hashbang, printProgram } from './print/index.js'
import { type Ast, type AstRoot, formatKeyOf, type JSAst, type TSAst, type TsxAst } from './Syntax.js'

export type Printer<T extends Ast> = (file: T, context: PrinterContext) => string
export interface PrinterContext {
  print: Printer<Ast>
}
export function print(file: Ast, registry: FormatRegistry): string {
  const context: PrinterContext = { print: (inner) => print(inner, registry) }
  return Option.match(registry.entryForFormat(formatKeyOf(file)), {
    onNone: () => {
      throw new Error(`No registered format renders the "${formatKeyOf(file)}" AST`)
    },
    onSome: (entry) => entry.print(file, context),
  })
}

const HASHBANG_FIELDS: Readonly<Record<string, (field: unknown) => boolean>> = {
  type: (field) => field === 'Hashbang',
  value: (field) => typeof field === 'string',
  start: (field) => typeof field === 'number',
}

function isHashbang(value: unknown): value is Hashbang {
  return Predicate.isObject(value) && Object.entries(HASHBANG_FIELDS).every(([key, accepts]) => accepts(value[key]))
}

const hashbangOf = (root: AstRoot): Hashbang | null => {
  const hashbang: unknown = Reflect.get(root, 'hashbang')
  if (!isHashbang(hashbang)) return null
  return hashbang
}

export const jsPrint: Printer<JSAst> = (file) => {
  return printProgram(file.root, { hashbang: hashbangOf(file.root) })
}

export const tsPrint: Printer<TSAst | TsxAst> = (file) => {
  return printProgram(file.root, { hashbang: hashbangOf(file.root) })
}
