import * as S from 'effect/Schema'

export class EmptyDirectoryRemovalRejected
  extends S.TaggedError<EmptyDirectoryRemovalRejected, { readonly brand: unique symbol }>()(
    'EmptyDirectoryRemovalRejected',
    {
      code: S.UndefinedOr(S.String),
      cause: S.Unknown,
    },
  )
{
  override get message(): string {
    return `Removing the directory failed (errno: ${String(this.code)})`
  }
}
