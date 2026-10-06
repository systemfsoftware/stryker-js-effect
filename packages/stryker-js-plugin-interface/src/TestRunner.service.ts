import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

import type * as Mutant from './Mutant/mod.js'

import type { DryRunOptions, DryRunResult, MutantRunEvent, TestRunnerCapabilities } from './TestRunner.schema.js'
import { TestRunnerFailed } from './TestRunner.schema.js'

export interface TestRunnerService {
  readonly capabilities: Effect.Effect<TestRunnerCapabilities, TestRunnerFailed>
  readonly init: Effect.Effect<void, TestRunnerFailed>
  readonly dryRun: (options: DryRunOptions) => Effect.Effect<DryRunResult, TestRunnerFailed>
  readonly mutantRun: (options: Mutant.MutantRunOptions) => Stream.Stream<MutantRunEvent, TestRunnerFailed>
  readonly dispose: Effect.Effect<void, TestRunnerFailed>
}

export class TestRunner extends Context.Service<TestRunner, TestRunnerService>()(
  '@systemfsoftware/stryker-js-plugin-interface/TestRunner.service/TestRunner',
) {}
