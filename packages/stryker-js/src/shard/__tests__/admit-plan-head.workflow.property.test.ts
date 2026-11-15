import { ShardPlanDiffScoped, ShardPlanFullScope } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
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

const headFieldsCase = Arbitrary.map(
  Arbitrary.all({
    scope: Arbitrary.schema(S.Union([ShardPlanDiffScoped, ShardPlanFullScope])),
    head: Arbitrary.schema(S.String),
    sources: Arbitrary.schema(S.String),
  }),
  ({ scope, head, sources }) => ({ scope, head, sources }),
)

const refusedCommandOf = (fields: {
  readonly scope: typeof ShardPlanDiffScoped.Type | typeof ShardPlanFullScope.Type
  readonly head: string
  readonly sources: string
}): boolean => Result.isFailure(S.decodeResult(AdmitPlanHeadCommand)(fields))

describe('admitPlanHead', () => {
  it.prop(
    '∀x_AdmitPlanHeadCommand_≡RefusedWhenHeadEmpty',
    { of: [headFieldsCase], subject: refusedCommandOf },
    (subject, [fields]) =>
      Arr.every(
        [fields, { ...fields, head: '' }],
        (drawn) => subject(drawn) === (drawn.head.length === 0),
      ),
  )

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
