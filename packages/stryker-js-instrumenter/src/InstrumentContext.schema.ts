import * as S from 'effect/Schema'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'

export class InstrumenterContext extends S.Class<InstrumenterContext>('InstrumenterContext')({
  activeMutant: S.optional(S.String),
  currentTestId: S.optional(S.String),
  mutantCoverage: S.optional(Mutant.MutantCoverageSchema),
  hitCount: S.optional(Mutant.HitCount),
  hitLimit: S.optional(Mutant.HitCount),
}) {
  static readonly NAMESPACE = '__stryker__'
  static readonly MUTATION_COVERAGE_OBJECT = 'mutantCoverage'
  static readonly ACTIVE_MUTANT = 'activeMutant'
  static readonly CURRENT_TEST_ID = 'currentTestId'
  static readonly HIT_COUNT = 'hitCount'
  static readonly HIT_LIMIT = 'hitLimit'
  static readonly ACTIVE_MUTANT_ENV_VARIABLE = '__STRYKER_ACTIVE_MUTANT__'
}
