import * as S from 'effect/Schema'

export class FileMatcher extends S.Class<FileMatcher, { readonly brand: unique symbol }>('FileMatcher')({
  pattern: S.Union([S.Boolean, S.String]),
  allowHiddenFiles: S.Boolean,
}) {}
