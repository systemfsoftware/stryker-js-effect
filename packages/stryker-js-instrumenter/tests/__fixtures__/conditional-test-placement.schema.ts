import * as S from 'effect/Schema'

export class PlacementHarnessError extends S.TaggedError<PlacementHarnessError>()('PlacementHarnessError', {
  message: S.String,
  cause: S.Defect(),
}) {}
