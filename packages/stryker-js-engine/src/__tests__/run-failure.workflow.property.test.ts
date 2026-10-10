import { Run } from '@systemfsoftware/stryker-js-contracts'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { exitCodeOf } from '../reporting/run-failure.js'

const FROZEN_CONFIG_CODE = 2

describe('exitCodeOf', () => {
  it.prop(
    '∀outcome_ExitCode_≡FrozenCodes',
    {
      of: [
        S.Union([
          Run.RunOk,
          Run.RunInterrupted,
          Run.RunParseFailed,
          Run.RunSurvivorsRejected,
          Run.RunConfigFailed,
          Run.RunRefused,
          Run.RunFailed,
        ]),
      ],
      subject: exitCodeOf,
    },
    (subject, [outcome]) =>
      Match.value(outcome).pipe(
        Match.tag('RunOk', () => subject(outcome) === 0),
        Match.tag('RunInterrupted', (interrupted) => subject(outcome) === interrupted.code),
        Match.tag('RunFailed', (failed) => subject(outcome) === failed.code),
        Match.orElse(() => subject(outcome) === FROZEN_CONFIG_CODE),
      ),
  )
})
