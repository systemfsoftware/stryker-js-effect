import type { Program, Statement } from '@systemfsoftware/stryker-ignorer-interface'

export type * from '@systemfsoftware/stryker-ignorer-interface'

declare const FormatIdTypeId: unique symbol

export type FormatId = string & { readonly [FormatIdTypeId]: typeof FormatIdTypeId }

export type ScriptFormat = 'js' | 'ts' | 'tsx'

export interface FrameworkClaim {
  readonly formatId: FormatId
  readonly extensions: readonly string[]
  readonly language: string
  readonly contractVersion: string
}

export interface ScriptRegion {
  readonly start: number
  readonly end: number
  readonly isExpression: boolean
  readonly scriptAst?: unknown
}

export interface EmbeddedDocument {
  readonly formatId: FormatId
  readonly rawContent: string
  readonly regions: readonly ScriptRegion[]
}

export interface FrameworkContext {
  readonly parseScript: (source: string, scriptFormat: ScriptFormat) => Program
  readonly transformScript: (script: Program) => Program
  readonly printScript: (script: Program) => string
  readonly instrumentationHeader: () => readonly Statement[]
}
