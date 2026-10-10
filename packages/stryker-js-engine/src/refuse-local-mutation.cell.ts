import { Cell } from '@systemfsoftware/effect-cell-types'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { Run } from '@systemfsoftware/stryker-js-contracts'
import {
  LocalMutationRefused,
  refuseLocalMutation,
  RefuseLocalMutationCommand,
} from './refuse-local-mutation.workflow.js'

export interface LocalMutationGuardInput {
  readonly options: Options.StrykerOptions
}

const envOf = (key: string): Effect.Effect<string | undefined> =>
  Config.option(Config.String(key)).pipe(
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed(() => undefined),
  )

const guardOf = <I extends LocalMutationGuardInput>(input: I): Effect.Effect<I, Run.StageError> =>
  Effect.gen(function*() {
    const githubActions = yield* envOf('GITHUB_ACTIONS')
    const allowLocalMutation = yield* envOf('ALLOW_LOCAL_MUTATION')
    const command = RefuseLocalMutationCommand.make({
      dryRunOnly: input.options.dryRunOnly,
      githubActions,
      allowLocalMutation,
    })
    return yield* Result.match(refuseLocalMutation(command), {
      onFailure: (refused: LocalMutationRefused) =>
        Effect.fail(Run.StageError.make({ stage: 'prepare', reason: refused.message, cause: refused })),
      onSuccess: () => Effect.succeed(input),
    })
  })

export const refuseLocalMutationCell = <I extends LocalMutationGuardInput>(
  input: I,
): Cell.Cell<I, I, Run.StageError, never> => Cell.fromEffect(guardOf(input))
