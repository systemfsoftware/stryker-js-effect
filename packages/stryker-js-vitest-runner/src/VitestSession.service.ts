import type { Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'

import type { StrykerNamespace, VitestRunnerOptions } from './VitestRunner.schema.js'
import type { VitestResolver } from './VitestRuntime.blueprint.js'
import type { HarnessKey, HarnessValue, VitestRuntime } from './VitestRuntime.handle.js'

/** Everything one worker's run of the vitest runner is configured with. */
export interface VitestSessionInput {
  readonly options: Options.StrykerOptions
  readonly sandboxDirectory: string
  readonly globalNamespace?: StrykerNamespace
  readonly resolveVitestFor?: VitestResolver
  readonly setupFilePath?: string
}

/**
 * The session a run works through: the live runtime, the options it was built
 * with, and the two writes a run makes before it collects.
 */
export interface VitestSessionShape {
  readonly options: Effect.Effect<VitestRunnerOptions, TestRunner.TestRunnerFailed>
  readonly runtime: Effect.Effect<VitestRuntime, TestRunner.TestRunnerFailed>
  readonly setMode: (mode: 'dry-run' | 'mutant') => Effect.Effect<void, TestRunner.TestRunnerFailed>
  readonly provide: (key: HarnessKey, value: HarnessValue) => Effect.Effect<void, TestRunner.TestRunnerFailed>
  readonly exposeRunStart: (notify: Effect.Effect<void>) => Effect.Effect<void, TestRunner.TestRunnerFailed>
  readonly clearRunStart: Effect.Effect<void, TestRunner.TestRunnerFailed>
  readonly close: Effect.Effect<void, TestRunner.TestRunnerFailed>
}

export class VitestSession extends Context.Service<VitestSession, VitestSessionShape>()(
  '@systemfsoftware/stryker-js-vitest-runner/VitestSession',
) {}
