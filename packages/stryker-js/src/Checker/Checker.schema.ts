import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export class UndescribableMutant extends S.TaggedError<UndescribableMutant>()('UndescribableMutant', {
  id: S.String,
  fileName: S.String,
  reason: S.String,
}) {}

export const CheckerMutantFromMutant = Mutant.pipe(
  S.decodeTo(CheckerMutantWire, {
    decode: SchemaTransformation.transform((m: Mutant) => ({
      id: m.id,
      fileName: m.fileName,
      mutatorName: m.mutatorName,
      replacement: m.replacement,
      location: m.location,
    })).decode,
    encode: SchemaTransformation.transform((w: CheckerMutantWire) =>
      Mutant.make({
        id: w.id,
        fileName: w.fileName,
        mutatorName: w.mutatorName,
        replacement: w.replacement,
        location: w.location,
      })
    ).encode,
  }),
)
