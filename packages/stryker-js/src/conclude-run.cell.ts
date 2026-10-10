import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Reports, Run } from '@systemfsoftware/stryker-js-contracts'
import { Engine } from '@systemfsoftware/stryker-js-engine'
import * as Effect from 'effect/Effect'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'
import { planRunConclusion, type PlanRunConclusionCommand } from './plan-run-conclusion.workflow.js'

export interface RunConclusion {
  readonly command: Run.RunOutcomeCommand
  readonly outcome: Result.Result<Run.RunOutcomeDecision, Run.RunOutcomeError>
  readonly error: string
}

export interface RunConclusionInput {
  readonly mode: Run.ResolvedMode
  readonly stream: Run.RunEventStream
  readonly basePath: string
  readonly pathService: Path.Path
  readonly runEvents: Run.RunEventStreamPort
  readonly concluded: RunConclusion
}

export type RunConclusionRaw = (typeof PlanRunConclusionCommand)['Encoded'] & {
  readonly conclusion: RunConclusionInput
}

const encodedCommandOf = (
  command: Run.RunOutcomeCommand,
): (typeof Run.RunOutcomeCommand)['Encoded'] => ({
  _tag: 'RunOutcomeCommand',
  observation: command.observation,
})

const readConclusion = Effect.fn(SpanTaxonomy.Spans.runConclusionRead.name)(function*(
  input: RunConclusionInput,
): Effect.fn.Return<RunConclusionRaw, never, Run.RunEventDrain> {
  const classified = Result.getOrElse(input.concluded.outcome, (interrupted) => interrupted)
  yield* input.stream.open
  return {
    _tag: 'PlanRunConclusionCommand' as const,
    command: encodedCommandOf(input.concluded.command),
    machine: input.mode.mode === 'machine',
    exitCode: Engine.runExitCodeFromOutcome(classified).code,
    outcome: classified._tag,
    error: input.concluded.error,
    conclusion: input,
  }
})

const writeStderrLine = (line: string): Effect.Effect<void, never, Stdio.Stdio> =>
  Effect.flatMap(
    Stdio.Stdio,
    (stdio) => Stream.run(Stream.succeed(`${line}\n`), stdio.stderr({ endOnDone: false })).pipe(Effect.ignore),
  )

const emitMachineModeOutputOf = (raw: RunConclusionRaw): Effect.Effect<void, never, Reports.MachineConsole> =>
  raw.conclusion.runEvents.emitMachineModeOutput({
    stream: raw.conclusion.stream,
    mode: raw.conclusion.mode,
    outcome: raw.conclusion.concluded.outcome,
    basePath: raw.conclusion.basePath,
    pathService: raw.conclusion.pathService,
  })

export const concludeRunCell = Sandwich.named(SpanTaxonomy.Spans.runConclude.name)(readConclusion)
  .decide(planRunConclusion)
  .write({
    RunConclusionEmittedOk: (_decision, raw) =>
      Effect.andThen(
        emitMachineModeOutputOf(raw),
        Effect.andThen(raw.conclusion.stream.closeAndDrain, Effect.void),
      ),
    RunConclusionEmittedFailed: (decision, raw) =>
      Effect.andThen(
        emitMachineModeOutputOf(raw),
        Effect.andThen(
          raw.conclusion.stream.closeAndDrain,
          Effect.fail(Run.RunExit.make({ code: decision.exitCode })),
        ),
      ),
    RunConclusionQuietOk: (_decision, raw) => Effect.andThen(raw.conclusion.stream.closeAndDrain, Effect.void),
    RunConclusionQuietFailed: (decision, raw) =>
      Effect.andThen(
        raw.conclusion.stream.closeAndDrain,
        Effect.andThen(
          writeStderrLine(`exit ${decision.exitCode} (${decision.exitClass}): ${decision.error}`),
          Effect.fail(Run.RunExit.make({ code: decision.exitCode })),
        ),
      ),
    CommandRejected: ({ issue }) =>
      Effect.fail(Run.StrykerError.make({ message: `the run conclusion command was rejected: ${issue}` })),
  })
