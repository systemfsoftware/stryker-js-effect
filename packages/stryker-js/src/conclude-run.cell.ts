import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'

import { RunExit, type RunOutcomeDecision, type RunOutcomeError } from './classify-run-outcome.workflow.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { planRunConclusion, type PlanRunConclusionCommand } from './plan-run-conclusion.workflow.js'
import { RunExitCode } from './reporting/run-failure.schema.js'
import type { RunEventDrain, RunEventStream, RunEventStreamPort } from './run-event-stream.service.js'
import { RunOutcomeCommand } from './RunOutcomeCommand.schema.js'
import { StrykerError } from './stryker-error.schema.js'

export interface RunConclusion {
  readonly command: RunOutcomeCommand
  readonly outcome: Result.Result<RunOutcomeDecision, RunOutcomeError>
  readonly error: string
}

export interface RunConclusionInput {
  readonly mode: ResolvedMode
  readonly stream: RunEventStream
  readonly basePath: string
  readonly pathService: Path.Path
  readonly runEvents: RunEventStreamPort
  readonly concluded: RunConclusion
}

export type RunConclusionRaw = (typeof PlanRunConclusionCommand)['Encoded'] & {
  readonly conclusion: RunConclusionInput
}

const encodedCommandOf = (
  command: RunOutcomeCommand,
): (typeof RunOutcomeCommand)['Encoded'] => ({
  _tag: command._tag,
  succeeded: command.succeeded,
  interrupted: command.interrupted,
  helpErrorCount: command.helpErrorCount,
  cliError: command.cliError,
  unrecognized: command.unrecognized,
  survivorsReason: command.survivorsReason,
  survivorsDiagnostic: command.survivorsDiagnostic,
  schemaError: command.schemaError,
  successExitClass: command.successExitClass,
  highestExitClass: command.highestExitClass,
  configDetail: command.configDetail,
  diagnostic: command.diagnostic,
})

const readConclusion = Effect.fn('stryker.run_conclusion.read')(function*(
  input: RunConclusionInput,
): Effect.fn.Return<RunConclusionRaw, never, RunEventDrain> {
  const classified = Result.getOrElse(input.concluded.outcome, (interrupted) => interrupted)
  yield* input.stream.open
  return {
    _tag: 'PlanRunConclusionCommand' as const,
    command: encodedCommandOf(input.concluded.command),
    machine: input.mode.mode === 'machine',
    exitCode: RunExitCode.fromOutcome(classified).code,
    outcome: classified._tag,
    error: input.concluded.error,
    conclusion: input,
  }
})

export const concludeRunCell = Sandwich.named('stryker.run.conclude')(readConclusion)
  .decide(planRunConclusion)
  .write({
    RunConclusionEmittedOk: (_decision, raw) =>
      Effect.andThen(
        raw.conclusion.runEvents.emitMachineModeOutput({
          stream: raw.conclusion.stream,
          mode: raw.conclusion.mode,
          outcome: raw.conclusion.concluded.outcome,
          basePath: raw.conclusion.basePath,
          pathService: raw.conclusion.pathService,
        }),
        Effect.andThen(raw.conclusion.stream.closeAndDrain, Effect.void),
      ),
    RunConclusionEmittedFailed: (decision, raw) =>
      Effect.andThen(
        raw.conclusion.runEvents.emitMachineModeOutput({
          stream: raw.conclusion.stream,
          mode: raw.conclusion.mode,
          outcome: raw.conclusion.concluded.outcome,
          basePath: raw.conclusion.basePath,
          pathService: raw.conclusion.pathService,
        }),
        Effect.andThen(
          raw.conclusion.stream.closeAndDrain,
          Effect.fail(RunExit.make({ code: decision.exitCode })),
        ),
      ),
    RunConclusionQuietOk: (_decision, raw) => Effect.andThen(raw.conclusion.stream.closeAndDrain, Effect.void),
    RunConclusionQuietFailed: (decision, raw) =>
      Effect.andThen(
        raw.conclusion.stream.closeAndDrain,
        Effect.fail(RunExit.make({ code: decision.exitCode })),
      ),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the run conclusion command was rejected: ${issue}` })),
  })
