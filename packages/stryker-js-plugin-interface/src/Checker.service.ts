import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as HashMap from 'effect/HashMap'

import type { CheckerMutantWire, CheckResult } from './Checker.schema.js'
import { CheckerFailed } from './Checker.schema.js'

export interface CheckerService {
  readonly init: Effect.Effect<void, CheckerFailed>
  readonly check: (
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<HashMap.HashMap<string, CheckResult>, CheckerFailed>
  readonly group: (
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<readonly (readonly string[])[], CheckerFailed>
}

export class Checker extends Context.Service<Checker, CheckerService>()(
  '@systemfsoftware/stryker-js-plugin-interface/Checker.service/Checker',
) {}
