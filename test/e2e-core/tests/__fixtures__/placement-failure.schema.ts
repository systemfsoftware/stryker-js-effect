import * as S from 'effect/Schema'

export class PlacementFixtureUnreadable extends S.TaggedError<PlacementFixtureUnreadable>()(
  'PlacementFixtureUnreadable',
  { reason: S.String },
) {
  override get message(): string {
    return this.reason
  }
}

export class PlacementSliceUndecodable extends S.TaggedError<PlacementSliceUndecodable>()(
  'PlacementSliceUndecodable',
  { reason: S.String },
) {
  override get message(): string {
    return this.reason
  }
}
