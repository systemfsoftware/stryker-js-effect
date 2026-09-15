import type { Program, Statement } from '@systemfsoftware/stryker-ignorer-interface'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import { FrameworkFailed } from './Framework.schema.js'

export { FrameworkFailed } from './Framework.schema.js'

export type ScriptFormat = 'js' | 'ts' | 'tsx'

export interface FrameworkClaim {
  readonly formatId: string
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
  readonly formatId: string
  readonly rawContent: string
  readonly regions: readonly ScriptRegion[]
}

export interface FrameworkContext {
  readonly parseScript: (source: string, scriptFormat: ScriptFormat) => Program
  readonly transformScript: (script: Program) => Program
  readonly printScript: (script: Program) => string
  readonly instrumentationHeader: () => readonly Statement[]
}

export interface FrameworkService {
  readonly claim: FrameworkClaim
  readonly parse: (rawContent: string, context: FrameworkContext) => Effect.Effect<EmbeddedDocument, FrameworkFailed>
  readonly transform: (
    document: EmbeddedDocument,
    context: FrameworkContext,
  ) => Effect.Effect<EmbeddedDocument, FrameworkFailed>
  readonly print: (document: EmbeddedDocument, context: FrameworkContext) => Effect.Effect<string, FrameworkFailed>
  readonly disableTypeChecks: (content: string) => Effect.Effect<string, FrameworkFailed>
}

export class Framework
  extends Context.Service<Framework, FrameworkService>()('~@systemfsoftware/stryker-js-language/Framework')
{}
