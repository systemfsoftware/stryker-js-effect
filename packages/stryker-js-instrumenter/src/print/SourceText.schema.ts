import * as S from 'effect/Schema'

export const SourceText = S.Unknown.pipe(
  S.decodeTo(S.NonEmptyString, {
    decode: () => '',
    encode: (text) => text,
  }),
)
export type SourceText = typeof SourceText.Type
