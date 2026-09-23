import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunnerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'

import { type TestRunnerPhase } from './VitestRunner.schema.js'

/**
 * The worker's side of the TestRunner protocol: every call runs against the
 * runner the composition root provided, and every failure leaves in the
 * runner's own failure envelope, tagged with the phase that produced it.
 */
const runnerFailed =
  (phase: TestRunnerPhase) =>
  <E>(cause: Cause.Cause<E>): TestRunnerFailed =>
    new TestRunnerFailed({ cause: Cause.pretty(cause), phase, runnerName: 'vitest' })

export const testRunnerHandlers = TestRunnerRpcs.toLayer(
  Effect.gen(function*() {
    const runner = yield* TestRunner
    return {
      capabilities: () => runner.capabilities.pipe(Effect.catchCause(runnerFailed('capabilities'))),
      dryRun: ({ options }) => runner.dryRun(options).pipe(Effect.catchCause(runnerFailed('dryRun'))),
      mutantRun: ({ options }) => runner.mutantRun(options).pipe(Effect.catchCause(runnerFailed('mutantRun'))),
    }
  }),
)
