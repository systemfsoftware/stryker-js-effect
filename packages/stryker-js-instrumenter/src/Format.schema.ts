import type { FormatId } from '@systemfsoftware/stryker-framework-interface'
import type * as Effect from 'effect/Effect'
import type * as Option from 'effect/Option'
import type { Ast, ScriptFormat } from './Ast.schema.js'
import type { InstrumentError } from './Instrument.schema.js'
import type { ParseFailed } from './Parser.schema.js'
import type { ParserContext } from './Parser.service.js'
import type { PrinterContext } from './Printer.handle.js'
import type { AstTransformer } from './Transformer.service.js'

export type FormatKind = 'script' | 'embedded'

export interface FormatClaim<Kind extends FormatKind = FormatKind> {
  readonly formatId: FormatId
  readonly extensions: readonly string[]
  readonly language: string
  readonly kind: Kind
}

export interface ScriptHooks {
  readonly parse: (
    text: string,
    fileName: string,
    context: ParserContext,
  ) => Effect.Effect<Ast, ParseFailed | InstrumentError>
  readonly transform: AstTransformer
  readonly print: (ast: Ast, context: PrinterContext) => string
  readonly disableTypeChecks: (ast: Ast) => Effect.Effect<string, InstrumentError>
}

export interface FormatHooks extends ScriptHooks {
  readonly owner: string
  readonly ownerVersion: string
}

export interface ScriptFormatEntry extends FormatHooks {
  readonly claim: FormatClaim<'script'>
  readonly scriptFormat: ScriptFormat
}

export interface EmbeddedFormatEntry extends FormatHooks {
  readonly claim: FormatClaim<'embedded'>
}

export type FormatEntry = ScriptFormatEntry | EmbeddedFormatEntry

export type EntryForFormat = (formatId: string) => Option.Option<FormatEntry>

export interface FormatRegistry {
  readonly entries: readonly FormatEntry[]
  readonly entryForFormat: EntryForFormat
  readonly entryForExtension: (extension: string) => Option.Option<FormatEntry>
}
