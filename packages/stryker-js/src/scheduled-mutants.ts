import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { type IncrementalDiffDecision, MutantToRun } from './incremental-diff.workflow.js'

export const scheduledMutants = (
  decisions: readonly IncrementalDiffDecision[],
): readonly Mutant.Mutant[] => decisions.flatMap((decision) => (S.is(MutantToRun)(decision) ? [decision.mutant] : []))
