import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import { type GuardRelationDecision } from './guard-relation.workflow.js'

export const guardsByMutantId = (
  decisions: readonly GuardRelationDecision[],
): ReadonlyMap<Mutant.MutantId, Mutant.Guard> =>
  new Map(
    decisions.flatMap((decision) =>
      Match.value(decision).pipe(
        Match.tag(
          'GuardedByBlock',
          (guarded): readonly (readonly [Mutant.MutantId, Mutant.Guard])[] => [[guarded.id, guarded.guard]],
        ),
        Match.tag('Guardless', () => []),
        Match.exhaustive,
      )
    ),
  )

const withGuardsDataFirst = <M extends { readonly id: Mutant.MutantId }>(
  mutants: readonly M[],
  decisions: readonly GuardRelationDecision[],
): readonly M[] => {
  const guards = guardsByMutantId(decisions)
  return mutants.map((mutant) =>
    Option.match(Option.fromUndefinedOr(guards.get(mutant.id)), {
      onNone: () => mutant,
      onSome: (guard) => ({ ...mutant, guard }),
    })
  )
}

export const withGuards: {
  <M extends { readonly id: Mutant.MutantId }>(
    mutants: readonly M[],
    decisions: readonly GuardRelationDecision[],
  ): readonly M[]
  <M extends { readonly id: Mutant.MutantId }>(
    decisions: readonly GuardRelationDecision[],
  ): (mutants: readonly M[]) => readonly M[]
} = dual((args: IArguments): boolean => args.length >= 2, withGuardsDataFirst)
