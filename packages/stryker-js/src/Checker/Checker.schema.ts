import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Metric from 'effect/Metric'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export class UndescribableMutant extends S.TaggedError<UndescribableMutant>()('UndescribableMutant', {
  id: Mutant.MutantId,
  fileName: S.String,
  reason: S.String,
}) {
  static readonly skipped = Metric.counter('stryker.checker.mutants.skipped', {
    description: 'Total number of mutants dropped because they cannot be described to a checker',
  })
}

const CheckerMutant = S.toType(Checker.CheckerMutantWire)

export const CheckerMutantFromMutant = S.decodeTo<typeof CheckerMutant, typeof Mutant.Mutant>(
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
      Mutant.Mutant.make({
        id: wire.id,
        fileName: wire.fileName,
        mutatorName: wire.mutatorName,
        replacement: wire.replacement,
        location: wire.location,
      }),
  }),
)(Mutant.Mutant)
