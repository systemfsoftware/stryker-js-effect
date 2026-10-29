import * as S from 'effect/Schema'

export class PlacementFixtureUnreadable
  extends S.TaggedError<PlacementFixtureUnreadable, { readonly brand: unique symbol }>()(
    'PlacementFixtureUnreadable',
    { reason: S.String },
  )
{
  override get message(): string {
    return this.reason
  }
}

export class PlacementSliceUndecodable
  extends S.TaggedError<PlacementSliceUndecodable, { readonly brand: unique symbol }>()(
    'PlacementSliceUndecodable',
    { reason: S.String },
  )
{
  override get message(): string {
    return this.reason
  }
}
