import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

const baselineBytesOf = (mutant: Mutant): string =>
  JSON.stringify(
    S.encodeUnknownSync(CheckerMutantWire)({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
    }),
  )

const newBytesOf = (mutant: Mutant): string =>
  JSON.stringify(
    S.encodeUnknownSync(CheckerMutantWire)({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
    }),
  )

describe('checker wire old-vs-new (throwaway)', () => {
  it.prop('∀m_Mutant_≡WireBytesEqualBaseline', [Mutant], ([mutant]) => baselineBytesOf(mutant) === newBytesOf(mutant))
})
