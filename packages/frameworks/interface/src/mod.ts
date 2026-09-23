import type { Program, Statement } from '@systemfsoftware/stryker-ignorer-interface'

export type * from '@systemfsoftware/stryker-ignorer-interface'

export type FormatId = string

export type ScriptFormat = 'js' | 'ts' | 'tsx'

export type FrameworkContractVersion = '1'

export interface FrameworkClaim {
  readonly formatId: FormatId
  readonly extensions: readonly string[]
  readonly language: string
  readonly ownerVersion: string
  readonly contractVersion: FrameworkContractVersion
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

export type FrameworkParseResult<A> =
  | { readonly kind: 'Parsed'; readonly value: A }
  | { readonly kind: 'ParseFailed'; readonly message: string }

export interface Framework {
  readonly kind: 'Framework'
  readonly name: string
  readonly claim: FrameworkClaim
  readonly parse: (rawContent: string, context: FrameworkContext) => FrameworkParseResult<EmbeddedDocument>
  readonly transform: (document: EmbeddedDocument, context: FrameworkContext) => EmbeddedDocument
  readonly print: (document: EmbeddedDocument, context: FrameworkContext) => string
  readonly disableTypeChecks: (rawContent: string) => FrameworkParseResult<string>
}

export type FrameworkRefusalReason = 'PeerMissing' | 'PeerVersionUnsupported'

export interface FrameworkRefusal {
  readonly kind: 'FrameworkRefusal'
  readonly name: string
  readonly reason: FrameworkRefusalReason
  readonly peer: string
  readonly detail: string
}

export type FrameworkContribution = Framework | FrameworkRefusal
