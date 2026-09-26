import { it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  interpretMutantRun,
  MutantRunObservation,
  MutantRunPoolInvalidated,
  MutantRunSettled,
} from '../interpret-mutant-run.workflow.js'

it.prop(
  '∀c_Observation_≡OnlyAWallClockClipRecyclesTheRunner',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        S.is(MutantRunPoolInvalidated)(decision)
          ? command.wallClockTimeout
          : S.is(MutantRunSettled)(decision) && !command.wallClockTimeout,
    }),
)
