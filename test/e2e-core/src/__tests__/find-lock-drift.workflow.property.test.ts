import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClosureMemberExtra,
  ClosureMemberMissing,
  findLockDrift,
  FindLockDriftCommand,
  LockMissing,
  PinMoved,
} from '../find-lock-drift.workflow.js'

describe('findLockDrift', () => {
  it.prop(
    '∀c_LockMissingReported_≡NoLockCommitted',
    { of: [FindLockDriftCommand], subject: findLockDrift },
    (subject, [command]) => {
      const drift = Result.getOrThrow(subject(command))
      const reportsMissing = drift.length === 1 && S.is(LockMissing)(drift[0])
      return reportsMissing === (command.lock === null) &&
        drift.every((finding) => !S.is(LockMissing)(finding) || reportsMissing)
    },
  )

  it.prop(
    '∀c_AnyLock_≡FindingsNameTheFixtureAndSideWithTheCommand',
    { of: [FindLockDriftCommand], subject: findLockDrift },
    (subject, [command]) =>
      Result.getOrThrow(subject(command)).every((finding) =>
        finding.fixtureId === command.fixtureId &&
        (!S.is(ClosureMemberMissing)(finding) || command.closure.includes(finding.packageName)) &&
        (!S.is(ClosureMemberExtra)(finding) || !command.closure.includes(finding.packageName)) &&
        (!S.is(PinMoved)(finding) ||
          (command.pins[finding.packageName] === finding.pinned && finding.pinned !== finding.locked))
      ),
  )
})
