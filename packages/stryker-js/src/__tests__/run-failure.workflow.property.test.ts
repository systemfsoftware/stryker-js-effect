import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

import {
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
  RunOk,
  RunParseFailed,
  RunSurvivorsRejected,
} from '../classify-run-outcome.workflow.js'
import { exitCodeOf } from '../reporting/run-failure.js'

const FROZEN_CONFIG_CODE = 2

describe('exitCodeOf', () => {
  it.prop(
    '∀outcome_ExitCode_≡FrozenCodes',
    {
      of: [
        S.Union([
          RunOk,
          RunInterrupted,
          RunParseFailed,
          RunSurvivorsRejected,
          RunConfigFailed,
          RunFailed,
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
