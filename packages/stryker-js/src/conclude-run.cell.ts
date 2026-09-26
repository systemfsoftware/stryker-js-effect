import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import type * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyRunOutcome, RunExit } from './classify-run-outcome.workflow.js'
import type { ResolvedMode } from './output-mode.schema.js'
import {
  FailedRunOutcomeSchema,
  planRunConclusion,
  type PlanRunConclusionCommand,
} from './plan-run-conclusion.workflow.js'
import { MachineConsole } from './reporting/machine-console.service.js'
import { ErrorEnvelope, RunExitCode } from './reporting/run-failure.schema.js'
import type { RunEventDrain, RunEventStream, RunEventStreamPort } from './run-event-stream.service.js'
import { RunOutcomeCommand } from './RunOutcomeCommand.schema.js'
import { StrykerError } from './stryker-error.schema.js'

export interface RunConclusionInput<E = unknown> {
  readonly exit: Exit.Exit<void, E>
  readonly argv: readonly string[]
  readonly mode: ResolvedMode
  readonly stream: RunEventStream
  readonly basePath: string
  readonly pathService: Path.Path
  readonly runEvents: RunEventStreamPort
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

const SPAN_ERROR_LIMIT = 1024
const TRUNCATION_SUFFIX = '…[truncated]'

const truncateForSpan = (text: string): string => {
  const over = Math.max(0, text.length - SPAN_ERROR_LIMIT)
  const suffix = TRUNCATION_SUFFIX.slice(0, Math.min(over, 1) * TRUNCATION_SUFFIX.length)
  return text.slice(0, SPAN_ERROR_LIMIT) + suffix
}

const readConclusion = (
  input: RunConclusionInput,
): Effect.Effect<RunConclusionRaw, never, RunEventDrain | MachineConsole> =>
  Effect.gen(function*() {
    const machineConsole = yield* MachineConsole
    const command = RunOutcomeCommand.fromExit({ exit: input.exit, argv: input.argv })
    const outcome = classifyRunOutcome(command)
    const classified = Result.getOrElse(outcome, (interrupted) => interrupted)
    const failed = Option.liftPredicate(S.is(FailedRunOutcomeSchema))(classified)
    const error = Option.getOrElse(
      Option.map(failed, (failure) =>
        truncateForSpan(ErrorEnvelope.fromOutcome({ error: failure, captured: machineConsole.read() }).error)),
      () =>
        '',
    )
    yield* input.stream.open
    return {
      _tag: 'PlanRunConclusionCommand' as const,
      command: encodedCommandOf(command),
      machine: input.mode.mode === 'machine',
      exitCode: RunExitCode.fromOutcome(classified).code,
      outcome: classified._tag,
      error,
      conclusion: input,
    }
  })

export const concludeRunCell = Sandwich.named('stryker.run.conclude')(readConclusion)
  .decide(planRunConclusion)
  .write({
    RunConclusionEmittedOk: (decision, raw) =>
      Effect.andThen(
        raw.conclusion.runEvents.emitMachineModeOutput({
          stream: raw.conclusion.stream,
          mode: raw.conclusion.mode,
          outcome: classifyRunOutcome(decision.command),
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
          outcome: classifyRunOutcome(decision.command),
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
