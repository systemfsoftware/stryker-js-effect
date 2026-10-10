import { it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutantKept, mutantSetPolicy, MutantSetPolicyCommand } from '../mutant-set-policy.workflow.js'

it.prop(
  '∀c_Command_≡TheFullPolicySuppressesNothing',
  { of: [MutantSetPolicyCommand], subject: mutantSetPolicy },
  (subject, [command]) =>
    Result.match(
      subject(MutantSetPolicyCommand.make({ policy: 'full', candidates: [...command.candidates] })),
      {
        onFailure: () => false,
        onSuccess: (outcomes) =>
          outcomes.length === command.candidates.length && outcomes.every((outcome) => S.is(MutantKept)(outcome)),
      },
    ),
)
