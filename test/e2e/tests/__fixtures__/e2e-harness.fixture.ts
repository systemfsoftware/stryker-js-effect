import { Stimulus } from '@systemfsoftware/trace-spec'
import { VitestTestContext } from '@systemfsoftware/vitest'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import { BakedFixtureCache } from '../../src/Harness/fixture-cache.service.js'
import type { BakePlatform } from '../../src/Harness/fixture-cache.service.js'
import type { ExecResult } from '../../src/Harness/guest-job.schema.js'
import type { HarnessError, SandboxForkFailure } from '../../src/Harness/harness-failure.schema.js'
import { HarnessPlatformLive, HarnessServicesLive } from '../../src/Harness/harness-layers.js'
import { StrykerCliRunner } from '../../src/Harness/stryker-cli-runner.service.js'
import * as Warm from '../../src/Harness/warm-sandbox.handle.js'

export const E2eHarnessLive = HarnessServicesLive.pipe(Layer.provideMerge(HarnessPlatformLive))

export interface StrykerRunInput {
  readonly fixture: URL
  readonly label: string
  readonly args: ReadonlyArray<string>
}

export interface StrykerRunOutput {
  readonly result: ExecResult
  readonly readFile: (relativePath: string) => Effect.Effect<string, SandboxForkFailure>
}

const TRACE_ANNOTATION_TYPE = 'trace'

const annotateTrace = (traceId: string): Effect.Effect<void> =>
  Effect.flatMap(VitestTestContext, (context) =>
    context === null
      ? Effect.void
      : Effect.promise(() => context.annotate(`trace ${traceId}`, TRACE_ANNOTATION_TYPE)))

export type StrykerRunStimulus = Stimulus.Stimulus<
  StrykerRunInput,
  StrykerRunOutput,
  HarnessError | SandboxForkFailure,
  BakedFixtureCache | StrykerCliRunner | BakePlatform | Scope.Scope
>

export const StrykerRun: StrykerRunStimulus = Stimulus.make({
  name: 'stryker CLI run',
  run: ({ input, traceId, traceparent }) =>
    Effect.gen(function*() {
      yield* annotateTrace(traceId)
      const cache = yield* BakedFixtureCache
      const warm = yield* cache.warm(input.fixture)
      const runner = yield* StrykerCliRunner
      const forked = yield* runner.run(input.args, warm, input.label, { TRACEPARENT: traceparent })
      return {
        result: forked.result,
        readFile: (relativePath: string) => Warm.readFile(forked.fork, relativePath),
      } satisfies StrykerRunOutput
    }),
})

export const runStryker = (
  input: StrykerRunInput,
): Effect.Effect<
  Stimulus.Run<StrykerRunInput, StrykerRunOutput>,
  HarnessError | SandboxForkFailure,
  BakedFixtureCache | StrykerCliRunner | BakePlatform | Scope.Scope
> => StrykerRun(input)
