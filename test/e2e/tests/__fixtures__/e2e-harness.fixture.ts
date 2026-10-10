import { decodeStream as decodeStreamWorkflow, DecodeStreamCommand } from '@systemfsoftware/stryker-e2e-core'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Stimulus } from '@systemfsoftware/trace-spec'
import { VitestTestContext } from '@systemfsoftware/vitest'
import { Effect, Layer, Option, Result, Schema as S } from 'effect'
import type { Config, Scope } from 'effect'

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
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly interrupt?: StrykerInterrupt | undefined
}

export interface StrykerInterrupt {
  readonly afterMutantEvents: number
  readonly storeDirectory: string
}

export interface GuestScriptInput {
  readonly fixture: URL
  readonly label: string
  readonly script: string
  readonly env?: Readonly<Record<string, string>> | undefined
}

export type StrykerReadFile = (relativePath: string) => Effect.Effect<string, SandboxForkFailure>

export type StrykerRunAgain = (
  args: ReadonlyArray<string>,
) => Effect.Effect<ExecResult, Config.ConfigError | SandboxForkFailure>

export interface StrykerRunOutput {
  readonly result: ExecResult
  readonly interrupted: boolean
  readonly readFile: StrykerReadFile
  readonly runAgain: StrykerRunAgain
}

const PERSIST_POLL_ATTEMPTS = 200
const PERSIST_POLL_INTERVAL_MILLIS = 50

const isMutantEvent = (
  event: RunEvent.RunEvent,
): event is Extract<RunEvent.RunEvent, { readonly _tag: 'mutantTested' }> => event._tag === 'mutantTested'

const isRemembered = S.is(Mutant.RememberedStatusSchema)

const streamEventsOf = (line: string): ReadonlyArray<RunEvent.RunEvent> =>
  Result.match(decodeStreamWorkflow(DecodeStreamCommand.make({ lines: [line] })), {
    onFailure: (): ReadonlyArray<RunEvent.RunEvent> => [],
    onSuccess: (decoded) => decoded.events,
  })

const isEntryFileName = (name: string): boolean => !name.startsWith('.') && name.endsWith('.json')

const storedEntryCountIn = async (guestFiles: Warm.GuestFiles, directory: string): Promise<number> => {
  const entries = await guestFiles.list(directory).catch((): ReadonlyArray<Warm.GuestEntry> => [])
  const nested = await Promise.all(
    entries.filter((entry) => entry.isDirectory).map((entry) =>
      storedEntryCountIn(guestFiles, `${directory}/${entry.name}`)
    ),
  )
  const here = entries.filter((entry) => !entry.isDirectory && isEntryFileName(entry.name)).length
  return nested.reduce((total, count) => total + count, here)
}

const awaitStored = async (guestFiles: Warm.GuestFiles, storeDirectory: string, count: number): Promise<boolean> => {
  for (let attempt = 0; attempt < PERSIST_POLL_ATTEMPTS; attempt = attempt + 1) {
    if (await storedEntryCountIn(guestFiles, storeDirectory) >= count) {
      return true
    }
    await Effect.runPromise(Effect.sleep(`${PERSIST_POLL_INTERVAL_MILLIS} millis`))
  }
  return false
}

const interruptAfter = (input: StrykerInterrupt): (
  line: string,
  guestFiles: Warm.GuestFiles,
) => Promise<boolean> => {
  const counted = new Set<string>()
  return async (line, guestFiles) => {
    streamEventsOf(line)
      .filter(isMutantEvent)
      .filter((event) => isRemembered(event.status))
      .forEach((event) => counted.add(event.id))
    if (counted.size < input.afterMutantEvents) {
      return false
    }
    return await awaitStored(guestFiles, input.storeDirectory, counted.size)
  }
}

const TRACE_ANNOTATION_TYPE = 'trace'

const annotateTrace = (traceId: string): Effect.Effect<void> =>
  Effect.flatMap(VitestTestContext, (context) =>
    context === null
      ? Effect.void
      : Effect.promise(() => context.annotate(`trace ${traceId}`, TRACE_ANNOTATION_TYPE)))

const outputOf = (
  runner: typeof StrykerCliRunner.Service,
  environment: Readonly<Record<string, string>>,
  fork: Warm.SandboxFork,
  result: ExecResult,
  interrupted: boolean,
): StrykerRunOutput => ({
  result,
  interrupted,
  readFile: (relativePath) => Warm.readFile(fork, relativePath),
  runAgain: (args) => runner.runInFork(args, fork, environment),
})

type HarnessRequirements = BakedFixtureCache | StrykerCliRunner | BakePlatform | Scope.Scope

export type StrykerRunStimulus = Stimulus.Stimulus<
  StrykerRunInput,
  StrykerRunOutput,
  HarnessError | SandboxForkFailure,
  HarnessRequirements
>

export const StrykerRun: StrykerRunStimulus = Stimulus.make({
  name: 'stryker CLI run',
  run: ({ input, traceId, traceparent }) =>
    Effect.gen(function*() {
      yield* annotateTrace(traceId)
      const cache = yield* BakedFixtureCache
      const warm = yield* cache.warm(input.fixture)
      const runner = yield* StrykerCliRunner
      const environment = { ...input.env, TRACEPARENT: traceparent }
      return yield* Option.match(Option.fromUndefinedOr(input.interrupt), {
        onNone: () =>
          Effect.map(
            runner.run(input.args, warm, input.label, environment),
            (ran) => outputOf(runner, environment, ran.fork, ran.result, false),
          ),
        onSome: (interrupt) =>
          Effect.map(
            runner.streamRun(input.args, warm, input.label, environment, interruptAfter(interrupt)),
            (ran) => outputOf(runner, environment, ran.fork, ran.result, ran.result.interrupted),
          ),
      })
    }),
})

export const runStryker = (
  input: StrykerRunInput,
): Effect.Effect<
  Stimulus.Run<StrykerRunInput, StrykerRunOutput>,
  HarnessError | SandboxForkFailure,
  HarnessRequirements
> => StrykerRun(input)

export type GuestScriptStimulus = Stimulus.Stimulus<
  GuestScriptInput,
  StrykerRunOutput,
  HarnessError | SandboxForkFailure,
  HarnessRequirements
>

export const GuestScript: GuestScriptStimulus = Stimulus.make({
  name: 'guest script of stryker CLI processes',
  run: ({ input, traceId, traceparent }) =>
    Effect.gen(function*() {
      yield* annotateTrace(traceId)
      const cache = yield* BakedFixtureCache
      const warm = yield* cache.warm(input.fixture)
      const runner = yield* StrykerCliRunner
      const environment = { ...input.env, TRACEPARENT: traceparent }
      const ran = yield* runner.runScript(input.script, warm, input.label, environment)
      return outputOf(runner, environment, ran.fork, ran.result, false)
    }),
})

export const runGuestScript = (
  input: GuestScriptInput,
): Effect.Effect<
  Stimulus.Run<GuestScriptInput, StrykerRunOutput>,
  HarnessError | SandboxForkFailure,
  HarnessRequirements
> => GuestScript(input)
