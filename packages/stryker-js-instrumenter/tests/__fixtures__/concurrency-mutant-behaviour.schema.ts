import * as S from 'effect/Schema'

export class FixtureImportError
  extends S.TaggedError<FixtureImportError, { readonly brand: unique symbol }>()('FixtureImportError', {
    url: S.String,
  })
{}
