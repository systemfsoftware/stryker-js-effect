import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export class UndescribableMutant extends S.TaggedError<UndescribableMutant>()('UndescribableMutant', {
  id: S.String,
  fileName: S.String,
  reason: S.String,
}) {}

export const CheckerMutantFromMutant = S.suspend(
  (): S.Schema<CheckerMutantWire, Mutant> =>
    Mutant.pipe(S.decodeTo(CheckerMutantWire, SchemaTransformation.transform({}))),
).annotations({ identifier: 'CheckerMutantFromMutant' })
