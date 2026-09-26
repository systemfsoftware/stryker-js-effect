import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
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
import { mergeReportsCell } from './merge-reports.cell.js'
import { MergeReportsFailed } from './merge-reports.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { routeCliRequest } from './route-cli-request.workflow.js'
import { RunEventDrain, type RunEventStream, type RunEventStreamPort } from './run-event-stream.service.js'
import type { HostServices } from './run/host.service.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { mutationTestCell } from './run/run-stages.cell.js'
import { RunEnvironment } from './run/RunEnvironment.service.js'
import { StrykerError } from './stryker-error.schema.js'
import type { SurvivorsAdmissionInput, SurvivorsSettlement } from './Survivors/mod.js'
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

const runStage = (channel: CliRead) =>
  Layer.build(RunEnvironment.stage(channel.environment.host.env, channel.environment.host.events)).pipe(
    Effect.flatMap((context) =>
      Cell.provideContext(mutationTestCell, context).run({
        cliOptions: channel.options,
        targetMutatePatterns: undefined,
      })
    ),
    Effect.orDie,
    Effect.scoped,
  )

const settlementOf = (channel: CliRead): SurvivorsSettlement => ({
  runAdmitted: ({ admitted, resolvedOptions, priorReportPath }) =>
    runStage({ ...channel, options: restrictedOptionsOf({ resolvedOptions, priorReportPath, admitted }) }),
  reportNoSurvivors: (resolvedOptions) =>
    channel.environment.runEvents.emitNullScoreVerdict({
      stream: channel.environment.stream,
      mode: channel.environment.mode,
      thresholds: resolvedOptions.thresholds,
      config: resolvedOptions,
      basePath: channel.environment.basePath,
      pathService: channel.environment.pathService,
    }),
})

const survivorsInputOf = (channel: CliRead): SurvivorsAdmissionInput => ({
  cliOptions: channel.options,
  mode: channel.environment.mode.mode,
  basePath: channel.environment.basePath,
  settle: settlementOf(channel),
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

export const runRequestCell = Sandwich.named('stryker.run_request')(readRunRequest)
  .decide(routeCliRequest)
  .write({
    CliHelpRequested: () => Effect.void,
    CliMergeReportsRequested: (merge, channel) =>
      mergeReportsCell.run({
        _tag: 'merge-reports',
        parts: merge.parts,
        out: merge.out,
        packages: merge.packages,
        mode: channel.environment.mode.mode,
      }),
    CliRunRequested: (_, channel) => runStage(channel),
    CliSurvivorsRequested: (_, channel) => survivorsAdmissionCell.run(survivorsInputOf(channel)),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the CLI read resolved a command the route schema rejects: ${issue}` })),
  })
