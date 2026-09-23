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

export class ParserNotFound
  extends S.TaggedError<ParserNotFound>('@systemfsoftware/stryker-js-instrumenter/Parser.schema/ParserNotFound')(
    'ParserNotFound',
    {
      fileName: S.String,
      extension: S.String,
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    return `No parser registered for ${this.fileName} (extension "${this.extension}")`
  }
}

export class SvelteVersionNotSupported extends S.TaggedError<SvelteVersionNotSupported>(
  '@systemfsoftware/stryker-js-instrumenter/Parser.schema/SvelteVersionNotSupported',
)('SvelteVersionNotSupported', {
  version: S.String,
  fileName: S.String,
  cause: S.Defect(),
}) {
  override get message(): string {
    return `Svelte version ${this.version} is not supported for ${this.fileName} (expected >=3.30)`
  }
}

export class SvelteWalkerNotFound extends S.TaggedError<SvelteWalkerNotFound>(
  '@systemfsoftware/stryker-js-instrumenter/Parser.schema/SvelteWalkerNotFound',
)(
  'SvelteWalkerNotFound',
  {
    fileName: S.String,
    cause: S.Defect(),
  },
) {
  override get message(): string {
    return `Svelte walker not found for ${this.fileName}`
  }
}

export class SvelteParseFailed
  extends S.TaggedError<SvelteParseFailed>('@systemfsoftware/stryker-js-instrumenter/Parser.schema/SvelteParseFailed')(
    'SvelteParseFailed',
    {
      fileName: S.String,
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    return `Failed to parse Svelte component ${this.fileName}`
  }
}
