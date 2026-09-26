import * as S from 'effect/Schema'
import { Position } from './Location.schema.js'

export class ParseFailed
  extends S.TaggedError<ParseFailed>('@systemfsoftware/stryker-js-instrumenter/Parser.schema/ParseFailed')(
    'ParseFailed',
    {
      fileName: S.String,
      message: S.String,
      location: Position,
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    return `Failed to parse ${this.fileName} at ${this.location.line}:${this.location.column}: ${this.message}`
  }
}
