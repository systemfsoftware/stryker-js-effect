import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Stimulus } from '@systemfsoftware/trace-spec'
import { VitestTestContext } from '@systemfsoftware/vitest'
import { Effect, Layer, Option, Result, Schema } from 'effect'
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
  readonly interrupt?: StrykerInterrupt | undefined
}

export interface StrykerInterrupt {
  readonly afterMutantEvents: number
  readonly checkpointFile: string
}

export type StrykerReadFile = (relativePath: string) => Effect.Effect<string, SandboxForkFailure>

export interface StrykerRunOutput {
  readonly result: ExecResult
  readonly interrupted: boolean
  readonly readFile: StrykerReadFile
}

const PERSIST_POLL_ATTEMPTS = 200
const PERSIST_POLL_INTERVAL_MILLIS = 50

const isMutantEvent = (
  event: RunEvent.RunEvent,
): event is Extract<RunEvent.RunEvent, { readonly _tag: 'mutantTested' }> => event._tag === 'mutantTested'

const decodeStreamText = Schema.decodeResult(RunEvent.RunEventWireText)

const decodeReport = Schema.decodeResult(Schema.fromJsonString(Report.MutationTestResult))

const streamEventsOf = (line: string): ReadonlyArray<RunEvent.RunEvent> =>
  Result.getOrElse(decodeStreamText(line), (): ReadonlyArray<RunEvent.RunEvent> => [])

const settledIdsOf = (report: Report.MutationTestResult): ReadonlyArray<string> =>
  Object.values(report.files).flatMap((file) =>
    file.mutants.filter((mutant) => mutant.status !== 'Pending').map((mutant) => mutant.id)
  )

const checkpointSettledIds = async (
  readGuestFile: Warm.GuestFileReader,
  checkpointFile: string,
): Promise<ReadonlyArray<string>> => {
  const text = await readGuestFile(checkpointFile).catch(() => undefined)
  return text === undefined
    ? []
    : Result.match(decodeReport(text), {
      onFailure: (): ReadonlyArray<string> => [],
      onSuccess: settledIdsOf,
    })
}

const checkpointListsAll = async (
  readGuestFile: Warm.GuestFileReader,
  checkpointFile: string,
  ids: ReadonlyArray<string>,
): Promise<boolean> => {
  const settled = new Set(await checkpointSettledIds(readGuestFile, checkpointFile))
  return ids.every((id) => settled.has(id))
}

const awaitPersisted = async (
  readGuestFile: Warm.GuestFileReader,
  checkpointFile: string,
  ids: ReadonlyArray<string>,
): Promise<boolean> => {
  for (let attempt = 0; attempt < PERSIST_POLL_ATTEMPTS; attempt = attempt + 1) {
    if (await checkpointListsAll(readGuestFile, checkpointFile, ids)) {
      return true
    }
    await Effect.runPromise(Effect.sleep(`${PERSIST_POLL_INTERVAL_MILLIS} millis`))
  }
  return false
}

const interruptAfter = (input: StrykerInterrupt): (
  line: string,
  readGuestFile: Warm.GuestFileReader,
) => Promise<boolean> => {
  const counted = new Set<string>()
  return async (line, readGuestFile) => {
    streamEventsOf(line).filter(isMutantEvent).forEach((event) => counted.add(event.id))
    if (counted.size < input.afterMutantEvents) {
      return false
    }
    return await awaitPersisted(readGuestFile, input.checkpointFile, [...counted])
  }
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
      const forkRun = yield* Option.match(Option.fromUndefinedOr(input.interrupt), {
        onNone: () =>
          Effect.map(
            runner.run(input.args, warm, input.label, { TRACEPARENT: traceparent }),
            (ran) => ({ result: ran.result, fork: ran.fork, interrupted: false }),
          ),
        onSome: (interrupt) =>
          Effect.map(
            runner.streamRun(
              input.args,
              warm,
              input.label,
              { TRACEPARENT: traceparent },
              interruptAfter(interrupt),
            ),
            (ran) => ({ result: ran.result, fork: ran.fork, interrupted: ran.result.interrupted }),
          ),
      })
      return {
        result: forkRun.result,
        interrupted: forkRun.interrupted,
        readFile: (relativePath: string) => Warm.readFile(forkRun.fork, relativePath),
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
