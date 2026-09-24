import { describe, it } from '@effect/vitest'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Exit from 'effect/Exit'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { RunMutantTested } from '../run-event.schema.js'

describe('RunMutantTested', () => {
  it.prop(
    '∀m_Tested_≡MachineAlphabet',
    [Arbitrary.schema(Reporter.MutantTested)],
    ([event]) =>
      Result.match(S.encodeResult(Reporter.MutantTested)(event), {
        onFailure: () => false,
        onSuccess: (encoded) => Exit.isSuccess(S.decodeExit(RunMutantTested)({ ...encoded, _tag: 'mutant' })),
      }),
  )
})
