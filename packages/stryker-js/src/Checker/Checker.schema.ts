import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export class UndescribableMutant extends S.TaggedError<UndescribableMutant>()('UndescribableMutant', {
  id: S.String,
  fileName: S.String,
  reason: S.String,
}) {}

const CheckerMutant = S.toType(CheckerMutantWire)

export const CheckerMutantFromMutant = S.decodeTo<typeof CheckerMutant, typeof Mutant>(
  CheckerMutant,
  SchemaTransformation.transform({
    decode: (mutant) => ({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
    }),
    encode: (wire) =>
      Mutant.make({
        id: wire.id,
        fileName: wire.fileName,
        mutatorName: wire.mutatorName,
        replacement: wire.replacement,
        location: wire.location,
      }),
  }),
)(Mutant)
