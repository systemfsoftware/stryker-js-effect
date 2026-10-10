import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  LocalMutationAllowed,
  LocalMutationRefused,
  refuseLocalMutation,
  RefuseLocalMutationCommand,
} from '../refuse-local-mutation.workflow.js'

const REFUSAL_MESSAGE = 'mutation runs only on main CI'

const permitsMutationRun = (command: RefuseLocalMutationCommand): boolean =>
  command.dryRunOnly || command.githubActions === 'true' || command.allowLocalMutation === '1'

describe('refuseLocalMutation', () => {
  it.prop(
    '∀c_Command_≡AllowedIffMainCiOrOverride',
    { of: [RefuseLocalMutationCommand], subject: refuseLocalMutation },
    (subject, [command]) => {
      const result = subject(command)
      return permitsMutationRun(command)
        ? Result.isSuccess(result) && S.is(LocalMutationAllowed)(result.success)
        : Result.isFailure(result) &&
          S.is(LocalMutationRefused)(result.failure) &&
          result.failure.message === REFUSAL_MESSAGE &&
          !result.failure.message.includes('ALLOW_LOCAL_MUTATION')
    },
  )
})
