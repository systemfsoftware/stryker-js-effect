import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export const CheckerMutantFromMutant: S.Codec<CheckerMutantWire, Mutant> = Mutant.pipe(
  S.decodeTo(
    CheckerMutantWire,
    SchemaTransformation.transform({
      decode: (m) => ({
        id: m.id,
        fileName: m.fileName,
        mutatorName: m.mutatorName,
        replacement: m.replacement,
        location: m.location,
      }),
      encode: (w) =>
        Mutant.make({
          id: w.id,
          fileName: w.fileName,
          mutatorName: w.mutatorName,
          replacement: w.replacement,
          location: w.location,
        }),
    }),
  ),
)

export interface UndescribableMutant {
  readonly id: string
  readonly fileName: string
  readonly reason: string
}

export const wireRecordOf = (mutant: Mutant): Result.Result<CheckerMutantWire, UndescribableMutant> =>
  Result.mapError(
    S.decodeResult(CheckerMutantFromMutant)(mutant),
    (error) => ({ id: mutant.id, fileName: mutant.fileName, reason: error.message }),
  )
