import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { admitPlanHead, AdmitPlanHeadCommand } from '../admit-plan-head.workflow.js'

const differing = (planned: string, drawn: string): string => planned === drawn ? `${drawn}\u0000` : drawn

const commandCase = Arbitrary.map(
  Arbitrary.all({
    command: Arbitrary.schema(AdmitPlanHeadCommand),
    sameHead: Arbitrary.schema(S.Boolean),
    sameWorktree: Arbitrary.schema(S.Boolean),
  }),
  ({ command, sameHead, sameWorktree }) =>
    AdmitPlanHeadCommand.make({
      scope: command.scope,
      head: sameHead ? command.scope.head : differing(command.scope.head, command.head),
      worktree: sameWorktree ? command.scope.worktree : differing(command.scope.worktree, command.worktree),
    }),
)

describe('admitPlanHead', () => {
  it.prop(
    '∀scope-head-worktree_AdmitPlanHead_≡AdmittedExactlyWhereTheCheckoutIsWhatThePlanWasScopedFrom',
    { of: [commandCase], subject: admitPlanHead },
    (subject, [command]) => {
      const headMatches = command.scope.head === command.head
      const worktreeMatches = command.scope.worktree === command.worktree
      return Result.match(subject(command), {
        onFailure: (refusal) =>
          !(headMatches && worktreeMatches) &&
          Match.value(refusal).pipe(
            Match.tag(
              'ShardPlanStale',
              (stale) => !headMatches && stale.planHead === command.scope.head && stale.head === command.head,
            ),
            Match.tag(
              'ShardPlanWorktreeStale',
              (stale) =>
                headMatches &&
                !worktreeMatches &&
                stale.planBase === command.scope.base &&
                stale.planWorktree === command.scope.worktree &&
                stale.worktree === command.worktree,
            ),
            Match.exhaustive,
          ),
        onSuccess: (current) => headMatches && worktreeMatches && current.head === command.head,
      })
    },
  )
})
