import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as S from 'effect/Schema'

import type { ScriptLanguage } from './import-closure.schema.js'

export interface ParsedSource {
  readonly program: S.Json
  readonly parseFailed: boolean
}

export interface SourceParserShape {
  readonly parseSource: (absolute: string, content: string, language: ScriptLanguage) => Effect.Effect<ParsedSource>
}

export class SourceParser extends Context.Service<SourceParser, SourceParserShape>()(
  '@systemfsoftware/stryker-js/source-parser.service/SourceParser',
) {}
