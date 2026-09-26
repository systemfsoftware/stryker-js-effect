import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import * as Bool from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as CliError from 'effect/unstable/cli/CliError'
import * as Command from 'effect/unstable/cli/Command'
import {
  classifyRunOutcome,
  type FailedRunOutcome,
  RunExit,
  type RunOutcomeDecision,
  type RunOutcomeError,
  RunParseFailed,
} from './classify-run-outcome.workflow.js'
import {
  type CliAnswer,
  type CliEnvironment,
  type CliFailure,
  type CliRead,
  readCliRoute,
  restrictedOptionsOf,
  runEffectOf,
  type StrykerCliInvocation,
} from './Cli.parts.js'
import { mergeReportsCell, type MergeReportsInvocation } from './merge-reports.cell.js'
import { OutputModeProbe } from './output-mode-probe.service.js'
import { MachineConsole } from './reporting/machine-console.service.js'
import { ErrorEnvelope, RunExitCode } from './reporting/run-failure.schema.js'
import { routeCliRequest } from './route-cli-request.workflow.js'
import { RunEventDrain, type RunEventStreamPort } from './run-event-stream.service.js'
import { type StrykerRun } from './run/host.service.js'
import { RunEnvironment } from './run/RunEnvironment.service.js'
import type { EnginePorts } from './run/StageServices.service.js'
import { RunOutcomeCommand } from './RunOutcomeCommand.schema.js'
import { StrykerError } from './stryker-error.schema.js'
import type { SurvivorsAdmissionAnswer, SurvivorsAdmissionInput } from './Survivors/mod.js'
import { survivorsAdmissionCell } from './Survivors/Survivors.cell.js'

const cliRouteCell = Sandwich.named('stryker.cli')(readCliRoute)
  .decide(routeCliRequest)
  .write({
    CliHelpRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CliMergeReportsRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CliRunRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CliSurvivorsRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the CLI read resolved a command the route schema rejects: ${issue}` })),
  })

const survivorsInputOf = (channel: CliRead): SurvivorsAdmissionInput => ({
  cliOptions: channel.options,
  mode: channel.environment.mode.mode,
  basePath: channel.environment.basePath,
})

const admissionCellOf = (answer: SurvivorsAdmissionAnswer, channel: CliRead) =>
  Match.value(answer.admission).pipe(
    Match.tag('NoSurvivors', () =>
      Cell.fromEffect(
        channel.environment.runEvents.emitNullScoreVerdict({
          stream: channel.environment.stream,
          mode: channel.environment.mode,
          thresholds: answer.resolvedOptions.thresholds,
          config: answer.resolvedOptions,
          basePath: channel.environment.basePath,
          pathService: channel.environment.pathService,
        }),
      )),
    Match.tag('Admitted', (admitted) =>
      runCellOf({
        ...channel,
        options: restrictedOptionsOf({
          resolvedOptions: answer.resolvedOptions,
          priorReportPath: answer.priorReportPath,
          admitted,
        }),
      })),
    Match.exhaustive,
  )

const runCellOf = (channel: CliRead) =>
  Cell.fromEffect(runEffectOf({ environment: channel.environment, options: channel.options }))

export const strykerCliCell = Cell.flatMap(
  cliRouteCell,
  (action): Cell.Cell<StrykerCliInvocation, CliAnswer, CliFailure, EnginePorts> =>
    Match.value(action.decision).pipe(
      Match.tag('CliHelpRequested', () => Cell.succeed<CliAnswer>(undefined)),
      Match.tag('CliMergeReportsRequested', (merge) =>
        Cell.mapInput(mergeReportsCell, (): MergeReportsInvocation => ({
          _tag: 'merge-reports',
          parts: merge.parts,
          out: merge.out,
          packages: merge.packages,
          mode: action.channel.environment.mode.mode,
        }))),
      Match.tag('CliRunRequested', () => runCellOf(action.channel)),
      Match.tag('CliSurvivorsRequested', () =>
        Cell.andThen(
          Cell.mapInput(survivorsAdmissionCell, () => survivorsInputOf(action.channel)),
          (answer) => admissionCellOf(answer, action.channel),
        )),
      Match.exhaustive,
    ),
)
export interface StrykerCliEffectOptions {
  readonly argv: readonly string[]
  readonly runMutationTest: StrykerRun | undefined
  readonly detectMode: OutputModeProbe['detectMode']
  readonly runEvents: RunEventStreamPort
}

const outcomeOf = (result: Result.Result<RunOutcomeDecision, RunOutcomeError>): string =>
  Result.match(result, {
    onSuccess: (decision) => decision._tag,
    onFailure: (error) => error._tag,
  })

const EXPORTABLE_SPAN_ERROR_LIMIT = 1024

const USAGE_EXIT_CODE = RunExitCode.fromOutcome(RunParseFailed.make({})).code

const truncatedForSpan = (text: string): string =>
  Bool.match(text.length > EXPORTABLE_SPAN_ERROR_LIMIT, {
    onTrue: () => `${text.slice(0, EXPORTABLE_SPAN_ERROR_LIMIT)}…[truncated]`,
    onFalse: () => text,
  })

const exportableErrorText = (failure: FailedRunOutcome, captured: string): string =>
  truncatedForSpan(ErrorEnvelope.fromOutcome({ error: failure, captured }).error)

const errorTextOf = (result: Result.Result<RunOutcomeDecision, RunOutcomeError>, captured: string) =>
  Result.match(result, {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('RunOk', () => ''),
        Match.orElse((failed) => exportableErrorText(failed, captured)),
      ),
    onFailure: (failure) => exportableErrorText(failure, captured),
  })

export const strykerCliEffect = (options: StrykerCliEffectOptions): Effect.Effect<
  void,
  PlatformError | RunExit | CliError.CliError,
  Command.Environment | RunEventDrain | EnginePorts | MachineConsole
> =>
  Effect.gen(function*() {
    const machineConsole = yield* MachineConsole
    const detectedMode = yield* Effect.result(options.detectMode)
    if (Result.isFailure(detectedMode)) {
      yield* Console.error(detectedMode.failure.message)
      return yield* RunExit.make({ code: USAGE_EXIT_CODE })
    }
    const mode = detectedMode.success
    const stream = yield* options.runEvents.createRunEventStream(mode)
    const noColor = yield* Config.String('NO_COLOR').pipe(Effect.option)
    const hostOptions = yield* RunEnvironment.forStream(mode, stream, {
      noColor: Option.getOrUndefined(noColor),
      builtinReporters: { html: HtmlReporter.makeHtmlReporter },
    })
    const pathService = yield* Path.Path
    const environment: CliEnvironment = {
      mode,
      stream,
      host: { env: hostOptions, events: stream.queue },
      basePath: hostOptions.basePath,
      pathService,
      runMutationTest: options.runMutationTest,
      runEvents: options.runEvents,
    }
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.withSpan('stryker.cli.run')(
        Effect.gen(function*() {
          const exit = yield* Effect.exit(
            restore(
              strykerCliCell.run({ argv: options.argv, environment }),
            ),
          )
          const outcome = classifyRunOutcome(RunOutcomeCommand.fromExit({ exit, argv: options.argv }))
          const code = RunExitCode.fromOutcome(
            Result.match(outcome, {
              onSuccess: (decision) => decision,
              onFailure: (interrupted) => interrupted,
            }),
          ).code
          yield* Effect.annotateCurrentSpan({
            'stryker.run.outcome': outcomeOf(outcome),
            'stryker.run.exit_code': code,
            'stryker.run.error': errorTextOf(outcome, machineConsole.read()),
          })
          yield* Bool.match(mode.mode === 'machine', {
            onTrue: () =>
              options.runEvents.emitMachineModeOutput({
                stream,
                mode,
                outcome,
                basePath: hostOptions.basePath,
                pathService,
              }),
            onFalse: () => Effect.void,
          })
          yield* stream.closeAndDrain
          yield* Result.match(outcome, {
            onSuccess: (decision) =>
              Match.value(decision).pipe(
                Match.tag('RunOk', () => Effect.void),
                Match.orElse(() => Effect.fail(RunExit.make({ code }))),
              ),
            onFailure: (interrupted) => Effect.fail(RunExit.make({ code: interrupted.code })),
          })
        }),
      )
    )
  })
