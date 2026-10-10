import { Engine } from '@systemfsoftware/stryker-js-engine'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const scheduledMutants = (
  decisions: readonly Engine.IncrementalDiffDecision[],
): readonly Mutant.Mutant[] =>
  decisions.flatMap((decision) => (S.is(Engine.MutantToRun)(decision) ? [decision.mutant] : []))
