import { describe, it } from '@effect/vitest'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckerMutantFromMutant } from '../Checker/Checker.schema.js'

const wireFieldsOf = (mutant: Mutant) => ({
  id: mutant.id,
  fileName: mutant.fileName,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: mutant.location,
})

describe('CheckerMutantFromMutant', () => {
  it.prop('∀w_Wire_≡DecodeEncodeIdentity', [Mutant], ([mutant]) =>
    Result.match(S.decodeResult(CheckerMutantFromMutant)(mutant), {
      onFailure: () => false,
      onSuccess: (wire) =>
        Result.match(S.encodeResult(CheckerMutantFromMutant)(wire), {
          onFailure: () => false,
          onSuccess: (roundTripped) =>
            roundTripped.id === mutant.id &&
            roundTripped.fileName === mutant.fileName &&
            roundTripped.mutatorName === mutant.mutatorName &&
            roundTripped.replacement === mutant.replacement &&
            S.is(Mutant)(roundTripped),
        }),
    }))

  it.prop('∀w_Wire_≡ConservesWireFields', [Mutant], ([mutant]) =>
    Result.match(S.decodeResult(CheckerMutantFromMutant)(mutant), {
      onFailure: () => false,
      onSuccess: (wire) =>
        wire.id === mutant.id &&
        wire.fileName === mutant.fileName &&
        wire.mutatorName === mutant.mutatorName &&
        wire.replacement === mutant.replacement,
    }))
  it.prop('∀w_Wire_≡RefusesUndescribable', [Mutant], ([mutant]) =>
    S.is(CheckerMutantFromMutant)(mutant) ||
    Result.isFailure(S.decodeResult(CheckerMutantFromMutant)({ ...wireFieldsOf(mutant), id: '' })),
  )
})
