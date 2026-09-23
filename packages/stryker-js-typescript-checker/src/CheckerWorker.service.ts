import type { Checker, CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerFailed, CheckerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import type { CheckerRuntimeShape } from './CheckerRuntime.service.js'
import { CheckerRuntime } from './CheckerRuntime.service.js'

const refuse = (checkerName: string, mutants: readonly CheckerMutantWire[], cause: string): CheckerFailed =>
  CheckerFailed.make({ checkerName, mutantIds: mutants.map((mutant) => mutant.id), cause })

const resolve = (
  runtime: CheckerRuntimeShape,
  checkerName: string,
  mutants: readonly CheckerMutantWire[],
): Effect.Effect<Checker['Service'], CheckerFailed> =>
  Match.value(checkerName).pipe(
    Match.when('typescript', () =>
      runtime.checker.pipe(
        Effect.result,
        Effect.flatMap(
          Result.match({
            onFailure: (cause) => Effect.fail(refuse(checkerName, mutants, Cause.pretty(cause))),
            onSuccess: Effect.succeed,
          }),
        ),
      )),
    Match.orElse(() => Effect.fail(refuse(checkerName, mutants, 'Checker ' + checkerName + ' does not exist'))),
  )

export const checkerHandlers = CheckerRpcs.toLayer(
  Effect.gen(function*() {
    const runtime = yield* CheckerRuntime
    return {
      check: ({
        checkerName,
        mutants,
      }: {
        readonly checkerName: string
        readonly mutants: readonly CheckerMutantWire[]
      }) =>
        resolve(runtime, checkerName, mutants).pipe(
          Effect.flatMap((checker) => checker.check([...mutants])),
          Effect.map((results) => Object.fromEntries(results)),
        ),

      group: ({
        checkerName,
        mutants,
      }: {
        readonly checkerName: string
        readonly mutants: readonly CheckerMutantWire[]
      }) => resolve(runtime, checkerName, mutants).pipe(Effect.flatMap((checker) => checker.group([...mutants]))),
    }
  }),
)
