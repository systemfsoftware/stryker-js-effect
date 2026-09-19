import { Mutant } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as HashMap from 'effect/HashMap'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import { CheckerFailed, CheckerMutantWire } from './Checker.schema.js'

export { CheckerFailed, CheckerMutantWire, CheckResultSchema, CheckStatus } from './Checker.schema.js'

export const CheckerMutantFromMutant: S.Codec<CheckerMutantWire, Mutant> = Mutant.pipe(
  S.decodeTo(
    CheckerMutantWire,
    SchemaTransformation.transform({
      decode: (m) => ({
        id: m.id,
        fileName: m.fileName,
        mutatorName: m.mutatorName,
        replacement: m.replacement,
        location: m.location,
      }),
      encode: (w) =>
        Mutant.make({
          id: w.id,
          fileName: w.fileName,
          mutatorName: w.mutatorName,
          replacement: w.replacement,
          location: w.location,
        }),
    }),
  ),
)

export interface FailedCheckResult {
  readonly reason: string
  readonly status: 'compileError'
}

export interface PassedCheckResult {
  readonly status: 'passed'
}

export type CheckResult = FailedCheckResult | PassedCheckResult

export interface CheckerService {
  readonly init: Effect.Effect<void, CheckerFailed>
  readonly check: (
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<HashMap.HashMap<string, CheckResult>, CheckerFailed>
  readonly group: (
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<readonly (readonly string[])[], CheckerFailed>
}

export class Checker
  extends Context.Service<Checker, CheckerService>()('@systemfsoftware/stryker-js-plugin-interface/Checker')
{}
