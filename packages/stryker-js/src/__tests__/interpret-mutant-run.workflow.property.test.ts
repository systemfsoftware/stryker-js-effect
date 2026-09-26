import { it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  interpretMutantRun,
  MutantRunObservation,
  MutantRunPoolInvalidated,
  MutantRunSettled,
  MutantRunWallClockStopped,
} from '../interpret-mutant-run.workflow.js'

const stopsOnWallClock = (command: MutantRunObservation): boolean =>
  Boolean.and(command.timedOut, Boolean.not(command.hitLimitReason))

it.prop(
  '∀c_Observation_≡TheOutcomeFollowsTheWallClockFacts',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        S.is(MutantRunPoolInvalidated)(decision)
          ? command.wallClockTimeout
          : S.is(MutantRunWallClockStopped)(decision)
          ? Boolean.and(Boolean.not(command.wallClockTimeout), stopsOnWallClock(command))
          : S.is(MutantRunSettled)(decision) &&
            Boolean.not(command.wallClockTimeout) &&
            Boolean.not(stopsOnWallClock(command)),
    }),
)
