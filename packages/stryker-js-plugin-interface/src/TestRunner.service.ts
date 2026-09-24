import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'

import type { DryRunOptions, DryRunResult, MutantRunResult, TestRunnerCapabilities } from './TestRunner.schema.js'
import { TestRunnerFailed } from './TestRunner.schema.js'

export interface TestRunnerService {
  readonly capabilities: Effect.Effect<TestRunnerCapabilities, TestRunnerFailed>
  readonly init: Effect.Effect<void, TestRunnerFailed>
  readonly dryRun: (options: DryRunOptions) => Effect.Effect<DryRunResult, TestRunnerFailed>
  readonly mutantRun: (options: Mutant.MutantRunOptions) => Effect.Effect<MutantRunResult, TestRunnerFailed>
  readonly dispose: Effect.Effect<void, TestRunnerFailed>
}

export class TestRunner extends Context.Service<TestRunner, TestRunnerService>()(
  '@systemfsoftware/stryker-js-plugin-interface/TestRunner.service/TestRunner',
) {}
