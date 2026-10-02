import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { FailureRecord, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { RunExit, RunOutcomeDecision } from './classify-run-outcome.workflow.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { planRunConclusion, type PlanRunConclusionCommand } from './plan-run-conclusion.workflow.js'
import type { RunEventDrain, RunEventStream, RunEventStreamPort } from './run-event-stream.service.js'
import { StrykerError } from './stryker-error.schema.js'
import { FAILURE_RECORD_FILE } from './stryker-outputs.js'

export interface RunConclusionInput {
  readonly mode: ResolvedMode
  readonly stream: RunEventStream
  readonly basePath: string
  readonly pathService: Path.Path
  readonly fileSystem: FileSystem.FileSystem
  readonly runEvents: RunEventStreamPort
  readonly decision: RunOutcomeDecision
}

export type RunConclusionRaw = (typeof PlanRunConclusionCommand)['Encoded'] & {
  readonly conclusion: RunConclusionInput
}

const readConclusion = Effect.fn(SpanTaxonomy.Spans.runConclusionRead.name)(function*(
  input: RunConclusionInput,
): Effect.fn.Return<RunConclusionRaw, never, RunEventDrain> {
  yield* input.stream.open
  return {
    _tag: 'PlanRunConclusionCommand' as const,
    decision: yield* Effect.orDie(S.encodeEffect(RunOutcomeDecision)(input.decision)),
    machine: input.mode.mode === 'machine',
    conclusion: input,
  }
})

const failureRecordPathOf = (conclusion: RunConclusionInput): string =>
  conclusion.pathService.resolve(conclusion.basePath, FAILURE_RECORD_FILE)

const writeFailureRecord = (conclusion: RunConclusionInput, record: FailureRecord.FailureRecord) =>
  Effect.gen(function*() {
    const file = failureRecordPathOf(conclusion)
    const text = yield* S.encodeEffect(FailureRecord.FailureRecordFile)(record)
    yield* conclusion.fileSystem.makeDirectory(conclusion.pathService.dirname(file), { recursive: true })
    yield* conclusion.fileSystem.writeFileString(file, `${text}\n`)
  }).pipe(
    Effect.tapError((error) => Effect.logWarning(`could not write ${FAILURE_RECORD_FILE}: ${error.message}`)),
    Effect.ignore,
  )

const removeStaleFailureRecord = (conclusion: RunConclusionInput) =>
  conclusion.fileSystem.remove(failureRecordPathOf(conclusion), { force: true }).pipe(
    Effect.tapError((error) => Effect.logWarning(`could not remove a stale ${FAILURE_RECORD_FILE}: ${error.message}`)),
    Effect.ignore,
  )

const closeAndExit = (conclusion: RunConclusionInput, exitCode: number) =>
  Effect.andThen(conclusion.stream.closeAndDrain, Effect.fail(RunExit.make({ code: exitCode })))

export const concludeRunCell = Sandwich.named(SpanTaxonomy.Spans.runConclude.name)(readConclusion)
  .decide(planRunConclusion)
  .write({
    RunConclusionEmittedOk: (decision, raw) =>
      removeStaleFailureRecord(raw.conclusion).pipe(
        Effect.andThen(
          raw.conclusion.runEvents.emitMachineModeOutput({
            stream: raw.conclusion.stream,
            mode: raw.conclusion.mode,
            ok: decision.ok,
            basePath: raw.conclusion.basePath,
            pathService: raw.conclusion.pathService,
          }),
        ),
        Effect.andThen(raw.conclusion.stream.closeAndDrain),
        Effect.asVoid,
      ),
    RunConclusionQuietOk: (_decision, raw) =>
      removeStaleFailureRecord(raw.conclusion).pipe(
        Effect.andThen(raw.conclusion.stream.closeAndDrain),
        Effect.asVoid,
      ),
    RunConclusionVerdictFailed: (decision, raw) =>
      removeStaleFailureRecord(raw.conclusion).pipe(
        Effect.andThen(closeAndExit(raw.conclusion, decision.exitCode)),
      ),
    RunConclusionFailed: (decision, raw) =>
      writeFailureRecord(raw.conclusion, decision.record).pipe(
        Effect.andThen(
          raw.conclusion.runEvents.emitFailureRecord(raw.conclusion.stream, decision.exitCode, decision.record),
        ),
        Effect.andThen(closeAndExit(raw.conclusion, decision.exitCode)),
      ),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the run conclusion command was rejected: ${issue}` })),
  })
