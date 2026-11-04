import * as S from 'effect/Schema'

export class StandbyThreadDied
  extends S.TaggedError<StandbyThreadDied, { readonly brand: unique symbol }>()('StandbyThreadDied', {
    cause: S.Unknown,
    message: S.String,
  })
{}

export class StandbyThreadStopFailed
  extends S.TaggedError<StandbyThreadStopFailed, { readonly brand: unique symbol }>()('StandbyThreadStopFailed', {
    cause: S.Unknown,
    message: S.String,
  })
{}

export type StandbyPoolFailed = StandbyThreadDied | StandbyThreadStopFailed
