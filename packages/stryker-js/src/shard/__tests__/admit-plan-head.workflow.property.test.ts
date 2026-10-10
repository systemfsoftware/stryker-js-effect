import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { admitPlanHead, AdmitPlanHeadCommand } from '../admit-plan-head.workflow.js'

const headCase = Arbitrary.map(
  Arbitrary.all({ command: Arbitrary.schema(AdmitPlanHeadCommand), sameHead: Arbitrary.schema(S.Boolean) }),
  ({ command, sameHead }) =>
    sameHead ? AdmitPlanHeadCommand.make({ scope: command.scope, head: command.scope.head }) : command,
)

describe('admitPlanHead', () => {
  it.prop(
    '∀scope-head_AdmitPlanHead_≡AdmittedExactlyWhenHeadIsThePlannedHead',
    { of: [headCase], subject: admitPlanHead },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: (stale) =>
          command.scope.head !== command.head && stale.planHead === command.scope.head && stale.head === command.head,
        onSuccess: (current) => command.scope.head === command.head && current.head === command.head,
      }),
  )
})
