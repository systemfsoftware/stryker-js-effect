import * as S from 'effect/Schema'

export class PlacementHarnessError
  extends S.TaggedError<PlacementHarnessError, { readonly brand: unique symbol }>()('PlacementHarnessError', {
    message: S.String,
    cause: S.Defect(),
  })
{}
