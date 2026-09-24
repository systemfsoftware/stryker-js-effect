import * as S from 'effect/Schema'

export class ParseFailed
  extends S.TaggedError<ParseFailed>('@systemfsoftware/stryker-js-instrumenter/Parser.schema/ParseFailed')(
    'ParseFailed',
    {
      fileName: S.String,
      message: S.String,
      location: S.Struct({ line: S.Finite, column: S.Finite }),
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    return `Failed to parse ${this.fileName} at ${this.location.line}:${this.location.column}: ${this.message}`
  }
}
