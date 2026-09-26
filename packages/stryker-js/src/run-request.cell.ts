import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import type { SchemaError } from 'effect/Schema'
import * as CliError from 'effect/unstable/cli/CliError'
import * as Command from 'effect/unstable/cli/Command'

import { type Admitted } from './admit-survivors-run.workflow.js'
import { CliRouteCommand } from './Cli.schema.js'
import {
  type ConfigFileInvalidError,
  type ConfigFileNotFoundError,
  type ConfigFileUnreadableError,
  type ConfigFileUnsupportedError,
} from './ConfigError.schema.js'
import { mergeReportsCell, type MergeReportsInvocation } from './merge-reports.cell.js'
import { MergeReportsFailed } from './merge-reports.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { routeCliRequest } from './route-cli-request.workflow.js'
import { RunEventDrain, type RunEventStream, type RunEventStreamPort } from './run-event-stream.service.js'
import type { HostServices } from './run/host.service.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { mutationTestCell } from './run/run-stages.cell.js'
import { RunEnvironment } from './run/RunEnvironment.service.js'
import type { EnginePorts } from './run/StageServices.service.js'
import { StrykerError } from './stryker-error.schema.js'
import type { SurvivorsAdmissionAnswer, SurvivorsAdmissionInput } from './Survivors/mod.js'
import { SurvivorsRejection } from './Survivors/mod.js'
import { survivorsAdmissionCell } from './Survivors/Survivors.cell.js'

export interface CliEnvironment {
  readonly mode: ResolvedMode
  readonly stream: RunEventStream
  readonly host: HostServices
  readonly basePath: string
  readonly pathService: Path.Path
  readonly runEvents: RunEventStreamPort
  readonly console: Console.Console
}

export interface CliInvocation {
  readonly route: CliRouteCommand
  readonly options: Options.PartialStrykerOptions
  readonly environment: CliEnvironment
}

export type CliRead = (typeof CliRouteCommand)['Encoded'] & {
  readonly environment: CliEnvironment
  readonly options: Options.PartialStrykerOptions
}

export type CliAnswer = void | MutationTestDone

export type CliFailure =
  | SchemaError
  | SurvivorsRejection
  | ConfigFileNotFoundError
  | ConfigFileUnreadableError
  | ConfigFileInvalidError
  | ConfigFileUnsupportedError
  | MergeReportsFailed

const progressStreamFileName = (options: Options.PartialStrykerOptions): string =>
  Option.getOrElse(
    S.decodeUnknownOption(S.NonEmptyString)(options['progressStreamFile']),
    () => RunEventDrain.DefaultProgressStreamFile,
  )

const readRunRequest = Effect.fn('stryker.run_request.gather')(function*(
  invocation: CliInvocation,
): Effect.fn.Return<CliRead, CliError.CliError, Command.Environment | RunEventDrain> {
  const drain = yield* RunEventDrain
  yield* drain.setProgressStreamFile(progressStreamFileName(invocation.options))
  yield* invocation.environment.stream.open
  return {
    _tag: invocation.route._tag,
    route: invocation.route.route,
    environment: invocation.environment,
    options: invocation.options,
  }
})

const routeCell = Sandwich.named('stryker.run_request')(readRunRequest)
  .decide(routeCliRequest)
  .write({
    CliHelpRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CliMergeReportsRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CliRunRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CliSurvivorsRequested: (decision, channel) => Effect.succeed({ decision, channel }),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the CLI read resolved a command the route schema rejects: ${issue}` })),
  })

const stageRunOf = (environment: CliEnvironment, options: Options.PartialStrykerOptions) =>
  Layer.build(RunEnvironment.stage(environment.host.env, environment.host.events)).pipe(
    Effect.flatMap((context) =>
      Cell.provideContext(mutationTestCell, context).run({
        cliOptions: options,
        targetMutatePatterns: undefined,
      })
    ),
    Effect.orDie,
    Effect.scoped,
  )

const runCellOf = (channel: CliRead) => Cell.fromEffect(stageRunOf(channel.environment, channel.options))

const survivorsInputOf = (channel: CliRead): SurvivorsAdmissionInput => ({
  cliOptions: channel.options,
  mode: channel.environment.mode.mode,
  basePath: channel.environment.basePath,
})

const restrictedOptionsOf = ({
  resolvedOptions,
  priorReportPath,
  admitted,
}: {
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
  readonly admitted: Admitted
}): Options.PartialStrykerOptions & {
  readonly survivors?: ReadonlyArray<Mutant.Mutant>
  readonly survivorsPriorReport?: string
  readonly mutate?: string[]
  readonly incremental?: boolean
} => ({
  ...resolvedOptions,
  survivors: admitted.survivors,
  mutate: [...admitted.mutateSpans],
  survivorsPriorReport: priorReportPath,
  incremental: false,
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

export const runRequestCell = Cell.flatMap(
  routeCell,
  (action): Cell.Cell<CliInvocation, CliAnswer, CliFailure, EnginePorts | RunEventDrain> =>
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
