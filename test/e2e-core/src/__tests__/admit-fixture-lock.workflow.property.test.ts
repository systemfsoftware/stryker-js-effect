import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitFixtureLock,
  AdmitFixtureLockCommand,
  LockAdmitted,
  LockProblemsListed,
  LockUnreadable,
} from '../admit-fixture-lock.workflow.js'

const failing = (command: AdmitFixtureLockCommand): AdmitFixtureLockCommand =>
  AdmitFixtureLockCommand.make({
    fixtureId: command.fixtureId,
    exitCode: command.exitCode === 0 ? 1 : command.exitCode,
    stdout: command.stdout,
    stderr: command.stderr,
  })

describe('admitFixtureLock', () => {
  it.prop(
    '∀c_ExitZero_≡LockAdmitted',
    { of: [AdmitFixtureLockCommand], subject: admitFixtureLock },
    (subject, [command]) => subject(command).pipe(Result.getOrThrow, S.is(LockAdmitted)) === (command.exitCode === 0),
  )

  it.prop(
    '∀c_NonZeroExit_≡NamedProblemsOrUnreadable',
    { of: [AdmitFixtureLockCommand], subject: admitFixtureLock },
    (subject, [command]) => {
      const admission = Result.getOrThrow(subject(failing(command)))
      return admission.fixtureId === command.fixtureId &&
        ((S.is(LockProblemsListed)(admission) && admission.problems.length > 0) ||
          (S.is(LockUnreadable)(admission) && admission.detail.length > 0))
    },
  )
})
