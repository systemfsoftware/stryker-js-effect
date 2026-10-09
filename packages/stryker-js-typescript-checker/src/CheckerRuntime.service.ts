import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'

export interface CheckerRuntimeShape {
  readonly checker: Effect.Effect<Checker.Checker['Service'], Cause.Cause<Checker.CheckerFailed>>
}

export class CheckerRuntime extends Context.Service<CheckerRuntime, CheckerRuntimeShape>()(
  '@systemfsoftware/stryker-js-typescript-checker/CheckerRuntime.service/CheckerRuntime',
) {}
