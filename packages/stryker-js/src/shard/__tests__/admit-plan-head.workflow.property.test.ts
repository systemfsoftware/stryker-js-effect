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
    sameSources: Arbitrary.schema(S.Boolean),
  }),
  ({ command, sameHead, sameSources }) =>
    AdmitPlanHeadCommand.make({
      scope: command.scope,
      head: sameHead ? command.scope.head : differing(command.scope.head, command.head),
      sources: sameSources ? command.scope.sources : differing(command.scope.sources, command.sources),
    }),
)

describe('admitPlanHead', () => {
  it.prop(
    '∀scope-head-sources_AdmitPlanHead_≡AdmittedExactlyWhereTheCheckoutIsWhatThePlanWasScopedFrom',
    { of: [commandCase], subject: admitPlanHead },
    (subject, [command]) => {
      const headMatches = command.scope.head === command.head
      const sourcesMatch = command.scope.sources === command.sources
      return Result.match(subject(command), {
        onFailure: (refusal) =>
          !(headMatches && sourcesMatch) &&
          Match.value(refusal).pipe(
            Match.tag(
              'ShardPlanStale',
              (stale) => !headMatches && stale.planHead === command.scope.head && stale.head === command.head,
            ),
            Match.tag(
              'ShardPlanWorktreeStale',
              (stale) =>
                headMatches &&
                !sourcesMatch &&
                stale.planBase === command.scope.base &&
                stale.planSources === command.scope.sources &&
                stale.sources === command.sources,
            ),
            Match.exhaustive,
          ),
        onSuccess: (current) => headMatches && sourcesMatch && current.head === command.head,
      })
    },
  )
})
