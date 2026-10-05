import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const LocalMutationDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/LocalMutationDecision',
)
type LocalMutationDecisionTypeId = typeof LocalMutationDecisionTypeId

export class RefuseLocalMutationCommand extends S.TaggedClass<RefuseLocalMutationCommand>()(
  'RefuseLocalMutationCommand',
  {
    dryRunOnly: S.Boolean,
    githubActions: S.UndefinedOr(S.String),
    allowLocalMutation: S.UndefinedOr(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class LocalMutationAllowed extends S.TaggedClass<LocalMutationAllowed>()('LocalMutationAllowed', {}) {
  readonly [LocalMutationDecisionTypeId] = LocalMutationDecisionTypeId
}

export class LocalMutationRefused extends S.TaggedError<LocalMutationRefused>()('LocalMutationRefused', {
  rule: RunEvent.RefusalRule,
  message: S.String,
}) {}

const decide = (
  command: RefuseLocalMutationCommand,
): Result.Result<LocalMutationAllowed, LocalMutationRefused> =>
  Match.value({
    dryRunOnly: command.dryRunOnly,
    githubActions: command.githubActions,
    allowLocalMutation: command.allowLocalMutation,
  }).pipe(
    Match.when({ dryRunOnly: true }, () => Result.succeed(LocalMutationAllowed.make({}))),
    Match.when({ githubActions: 'true' }, () => Result.succeed(LocalMutationAllowed.make({}))),
    Match.when({ allowLocalMutation: '1' }, () => Result.succeed(LocalMutationAllowed.make({}))),
    Match.orElse(() =>
      Result.fail(
        LocalMutationRefused.make({
          rule: 'mutation-runs-on-main-ci',
          message: 'mutation runs only on main CI',
        }),
      )
    ),
  )

export const refuseLocalMutation = Workflow.make({
  command: RefuseLocalMutationCommand,
  decision: LocalMutationAllowed,
  error: LocalMutationRefused,
  decide,
})
