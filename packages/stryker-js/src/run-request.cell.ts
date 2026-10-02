import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as CliError from 'effect/cli/CliError'
import * as Command from 'effect/cli/Command'
import type * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { SchemaError } from 'effect/Schema'

import { type Admitted } from './admit-survivors-run.workflow.js'
import { Baseline } from './Baseline.schema.js'
import { addressFields, portFields } from './cli-route-fields.js'
import { CliRouteCommand, type FeedbackJudgment, type ServeChannel } from './Cli.schema.js'
import {
  CompareFailed,
  compareVerdicts,
  CompareVerdictsCommand,
  type VerdictReport,
  VerdictSchema,
  VerdictsDiffer,
} from './compare-verdicts.workflow.js'
import {
  type ConfigFileInvalidError,
  type ConfigFileNotFoundError,
  type ConfigFileUnreadableError,
  type ConfigFileUnsupportedError,
} from './ConfigError.schema.js'
import { recordFeedbackCell } from './Feedback/Feedback.cell.js'
import { FeedbackUnusable } from './Feedback/Feedback.schema.js'
import {
  type GateEntry,
  GateInputUnusable,
  gateNewSurvivors,
  GateNewSurvivorsCommand,
  GateRejected,
} from './gate-new-survivors.workflow.js'
import { mcpServerLayer } from './Mcp/mod.js'
import { mergeReportsCell } from './merge-reports.cell.js'
import { MergeReportsFailed } from './merge-reports.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { AnnotationsUnusable, renderAnnotations, RenderAnnotationsCommand } from './render-annotations.workflow.js'
import {
  mutantRerunAdmissionCell,
  type MutantRerunInput,
  type MutantRerunSettlement,
  RerunRefused,
} from './Rerun/mod.js'
import { routeCliRequest } from './route-cli-request.workflow.js'
import { RunEventDrain, type RunEventStream, type RunEventStreamPort } from './run-event-stream.service.js'
import type { HostServices } from './run/host.service.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { mutationTestCell } from './run/run-stages.cell.js'
import { RunEnvironment } from './run/RunEnvironment.service.js'
import { serveMutationServer, type ServeRequest } from './Serve/Serve.cell.js'
import { StrykerError } from './stryker-error.schema.js'
import { FAILURE_RECORD_FILE } from './stryker-outputs.js'
import { annotationLinesOf, surfacedSurvivorsOf } from './surfacing.js'
import { type SurfacingCaps, SurfacingFields } from './surfacing.schema.js'
import type { SurvivorsAdmissionInput, SurvivorsSettlement } from './Survivors/mod.js'
import { SurvivorsRejection } from './Survivors/mod.js'
import { survivorsAdmissionCell } from './Survivors/Survivors.cell.js'
import { PriorReportDocument } from './Survivors/Survivors.schema.js'

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
  | RerunRefused
  | ConfigFileNotFoundError
  | ConfigFileUnreadableError
  | ConfigFileInvalidError
  | ConfigFileUnsupportedError
  | CompareFailed
  | VerdictsDiffer
  | GateRejected
  | GateInputUnusable
  | AnnotationsUnusable
  | MergeReportsFailed
  | FeedbackUnusable

const progressStreamFileName = (options: Options.PartialStrykerOptions): string =>
  Option.getOrElse(
    S.decodeUnknownOption(S.NonEmptyString)(options['progressStreamFile']),
    () => RunEventDrain.DefaultProgressStreamFile,
  )

const readRunRequest = Effect.fn(SpanTaxonomy.Spans.runRequestGather.name)(function*(
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

const rerunRestrictedOptionsOf = ({
  ids,
  mutateSpans,
  resolvedOptions,
}: {
  readonly ids: ReadonlyArray<string>
  readonly mutateSpans: ReadonlyArray<string>
  readonly resolvedOptions: Options.StrykerOptions
}): Options.PartialStrykerOptions & {
  readonly mutantIds?: ReadonlyArray<string>
  readonly mutate?: ReadonlyArray<string>
  readonly incremental?: boolean
  readonly incrementalFile?: string
} => ({
  ...resolvedOptions,
  mutate: [...mutateSpans],
  mutantIds: [...ids],
  incremental: true,
})

const rerunSettlementOf = (channel: CliRead): MutantRerunSettlement => ({
  runAdmitted: ({ ids, mutateSpans, resolvedOptions }) =>
    runStage({ ...channel, options: rerunRestrictedOptionsOf({ ids, mutateSpans, resolvedOptions }) }),
})

const rerunInputOf = (channel: CliRead, ids: ReadonlyArray<string>): MutantRerunInput => ({
  ids,
  cliOptions: channel.options,
  mode: channel.environment.mode.mode,
  basePath: channel.environment.basePath,
  settle: rerunSettlementOf(channel),
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

const decodeVerdictReport = S.decodeUnknownResult(S.fromJsonString(VerdictSchema))

const decodeNoise = S.decodeUnknownResult(S.fromJsonString(S.Array(S.String)))

const readReportText = (
  file: string,
  what: string,
): Effect.Effect<string, CompareFailed, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(file).pipe(
      Effect.mapError(() => CompareFailed.make({ reason: `cannot read the ${what} at ${file}` })),
    )
  })

const readVerdictReport = (
  file: string,
  what: string,
): Effect.Effect<VerdictReport, CompareFailed, FileSystem.FileSystem> =>
  Effect.flatMap(readReportText(file, what), (text) =>
    Effect.fromResult(
      Result.mapError(
        decodeVerdictReport(text),
        (error) => CompareFailed.make({ reason: `cannot decode the ${what} at ${file}: ${error.message}` }),
      ),
    ))

const readNoiseFile = (file: string): Effect.Effect<readonly string[], CompareFailed, FileSystem.FileSystem> =>
  Effect.flatMap(readReportText(file, 'noise file'), (text) =>
    Effect.fromResult(
      Result.mapError(
        decodeNoise(text),
        (error) => CompareFailed.make({ reason: `cannot decode the noise file at ${file}: ${error.message}` }),
      ),
    ))

const readNoise = (
  file: string | undefined,
): Effect.Effect<readonly string[], CompareFailed, FileSystem.FileSystem> =>
  Effect.map(
    Effect.forEach(Option.toArray(Option.fromUndefinedOr(file)), readNoiseFile),
    (lists) => lists.flat(),
  )

const compareReports = (
  compare: { readonly baseline: string; readonly fresh: string; readonly noise?: string | undefined },
): Effect.Effect<void, CompareFailed | VerdictsDiffer, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const baseline = yield* readVerdictReport(compare.baseline, 'baseline report')
    const fresh = yield* readVerdictReport(compare.fresh, 'fresh report')
    const noise = yield* readNoise(compare.noise)
    return yield* Effect.fromResult(compareVerdicts(CompareVerdictsCommand.make({ baseline, fresh, noise })))
  }).pipe(
    Effect.tapError((failure) => Effect.logError(failure.message)),
    Effect.asVoid,
  )

const GATE_REPORT_FILE = 'reports/mutation/mutation.json'

const decodeGateReport = S.decodeUnknownResult(S.fromJsonString(PriorReportDocument))
const decodeGateBaseline = S.decodeUnknownResult(S.fromJsonString(Baseline))

const gateEntriesOf = (report: PriorReportDocument): ReadonlyArray<GateEntry> =>
  Object.entries(report.files).flatMap(([fileName, file]) =>
    file.mutants.map((mutant) => ({
      id: mutant.id,
      fileName,
      line: mutant.location.start.line,
      status: mutant.status,
    }))
  )

const readGateReport = (
  file: string,
): Effect.Effect<PriorReportDocument, GateInputUnusable, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(file).pipe(
      Effect.mapError(() =>
        GateInputUnusable.make({
          reason: `cannot read the finished mutation report at ${file}; run \`stryker run\` first`,
        })
      ),
      Effect.flatMap((text) =>
        Effect.fromResult(
          Result.mapError(
            decodeGateReport(text),
            (error) =>
              GateInputUnusable.make({
                reason: `cannot decode the finished mutation report at ${file}: ${error.message}`,
              }),
          ),
        )
      ),
    ))

const readCommittedBaseline = (file: string): Effect.Effect<Option.Option<Baseline>, never, FileSystem.FileSystem> =>
  Effect.option(
    Effect.flatMap(
      FileSystem.FileSystem,
      (fs) => fs.readFileString(file).pipe(Effect.flatMap((text) => Effect.fromResult(decodeGateBaseline(text)))),
    ),
  )

const writeGateBaseline = (
  file: string,
  baseline: Baseline,
): Effect.Effect<void, GateInputUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* Effect.orDie(S.encodeEffect(S.fromJsonString(Baseline, { space: 2 }))(baseline))
    yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(file, text)),
      Effect.mapError(() => GateInputUnusable.make({ reason: `cannot write the committed baseline at ${file}` })),
    )
  })

const writeDecidedBaseline = (
  file: string,
  decided: Baseline | null,
): Effect.Effect<void, GateInputUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.forEach(
    Option.toArray(Option.fromNullishOr(decided)),
    (baseline) => writeGateBaseline(file, baseline),
    { discard: true },
  )

const reportUnchecked = (unchecked: ReadonlyArray<Mutant.MutantId>): Effect.Effect<void> =>
  Effect.logInfo(`stryker gate: ${unchecked.length} mutant(s) unchecked (in scope with no verdict)`)

const gateReport = (
  gate: { readonly baseline: string; readonly updateBaseline: boolean },
  channel: CliRead,
): Effect.Effect<void, GateRejected | GateInputUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const basePath = channel.environment.basePath
    const baselineFile = path.resolve(basePath, gate.baseline)
    const report = yield* readGateReport(path.resolve(basePath, GATE_REPORT_FILE))
    const committed = yield* readCommittedBaseline(baselineFile)
    const decision = yield* Effect.fromResult(
      gateNewSurvivors(
        GateNewSurvivorsCommand.make({
          entries: gateEntriesOf(report),
          committed: Option.getOrNull(Option.map(committed, (baseline) => baseline.survivors)),
          baselineFile: gate.baseline,
          updateBaseline: gate.updateBaseline,
        }),
      ),
    )
    yield* writeDecidedBaseline(baselineFile, decision.baseline)
    yield* reportUnchecked(decision.unchecked)
  })

const SURFACING_DEFAULTS: SurfacingCaps = { perLine: 1, perFile: 7 }

const surfacingFieldsOf = (report: Report.MutationTestResult): Option.Option<SurfacingFields> =>
  Option.flatMap(
    Option.fromUndefinedOr(report.config?.['surfacing']),
    (surfacing) => S.decodeUnknownOption(SurfacingFields)(surfacing),
  )

const capsOf = (fields: SurfacingFields): SurfacingCaps => ({
  perLine: Option.getOrElse(Option.fromNullishOr(fields.perLine), () => SURFACING_DEFAULTS.perLine),
  perFile: Option.getOrElse(Option.fromNullishOr(fields.perFile), () => SURFACING_DEFAULTS.perFile),
})

const surfacingCapsOf = (report: Report.MutationTestResult): SurfacingCaps =>
  Option.getOrElse(Option.map(surfacingFieldsOf(report), capsOf), () => SURFACING_DEFAULTS)

const decodeAnnotateReport = S.decodeUnknownResult(S.fromJsonString(Report.MutationTestResult))
const decodeAnnotateFailure = S.decodeUnknownOption(FailureRecord.FailureRecordFile)

const readAnnotateReport = (
  file: string,
): Effect.Effect<Report.MutationTestResult, AnnotationsUnusable, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(file).pipe(
      Effect.mapError(() =>
        AnnotationsUnusable.make({
          reason: `cannot read the finished mutation report at ${file}; run \`stryker run\` first`,
        })
      ),
      Effect.flatMap((text) =>
        Effect.fromResult(
          Result.mapError(
            decodeAnnotateReport(text),
            (error) =>
              AnnotationsUnusable.make({
                reason: `cannot decode the finished mutation report at ${file}: ${error.message}`,
              }),
          ),
        )
      ),
    ))

const readAnnotateFailureAnnotations = (
  file: string,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(file).pipe(
      Effect.asSome,
      Effect.catchTag('PlatformError', () => Effect.succeed(Option.none<string>())),
      Effect.map((text) =>
        Option.flatMap(text, decodeAnnotateFailure).pipe(
          Option.map(FailureRecord.annotationsOf),
          Option.getOrElse((): ReadonlyArray<string> => []),
        )
      ),
    ))

const readAnnotateBaseline = (
  file: string,
): Effect.Effect<ReadonlyArray<Mutant.MutantId>, AnnotationsUnusable, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(file).pipe(
      Effect.mapError(() => AnnotationsUnusable.make({ reason: `cannot read the committed baseline at ${file}` })),
      Effect.flatMap((text) =>
        Effect.fromResult(
          Result.mapError(
            decodeGateBaseline(text),
            (error) =>
              AnnotationsUnusable.make({ reason: `cannot decode the committed baseline at ${file}: ${error.message}` }),
          ),
        )
      ),
      Effect.map((baseline) => baseline.survivors),
    ))

const annotateReport = (
  annotate: { readonly baseline?: string | undefined },
  channel: CliRead,
): Effect.Effect<void, AnnotationsUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const basePath = channel.environment.basePath
    const report = yield* readAnnotateReport(path.resolve(basePath, GATE_REPORT_FILE))
    const failureAnnotations = yield* readAnnotateFailureAnnotations(path.resolve(basePath, FAILURE_RECORD_FILE))
    const baseline = yield* Effect.forEach(
      Option.toArray(Option.fromUndefinedOr(annotate.baseline)),
      (file) => readAnnotateBaseline(path.resolve(basePath, file)),
    )
    const decision = Result.getOrThrow(
      renderAnnotations(
        RenderAnnotationsCommand.make({
          report,
          survivors: surfacedSurvivorsOf(report, surfacingCapsOf(report)),
          baseline: baseline.flat(),
          failureAnnotations,
        }),
      ),
    )
    yield* Effect.forEach(
      annotationLinesOf(decision),
      (line) => Effect.sync(() => channel.environment.console.log(line)),
      { discard: true },
    )
  })

const serveRequestOf = (
  serve: { readonly channel: ServeChannel; readonly port?: number | undefined; readonly address?: string | undefined },
  cliOptions: Options.PartialStrykerOptions,
): ServeRequest => ({
  channel: serve.channel,
  cliOptions,
  ...portFields(serve.port),
  ...addressFields(serve.address),
})

const feedbackRoute = (
  feedback: { readonly id: string; readonly judgment: FeedbackJudgment; readonly reason?: string | undefined },
  channel: CliRead,
): Effect.Effect<void, FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const recorded = yield* recordFeedbackCell({
      basePath: channel.environment.basePath,
      id: feedback.id,
      judgment: feedback.judgment,
      reason: feedback.reason ?? null,
    })
    const line = yield* Effect.orDie(S.encodeEffect(S.fromJsonString(RunEvent.FeedbackReported))(recorded))
    yield* Effect.sync(() => channel.environment.console.log(line))
  })

export const runRequestCell = Sandwich.named(SpanTaxonomy.Spans.runRequest.name)(readRunRequest)
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
    CliCompareRequested: (compare) => compareReports(compare),
    CliGateRequested: (gate, channel) => gateReport(gate, channel),
    CliAnnotateRequested: (annotate, channel) => annotateReport(annotate, channel),
    CliFeedbackRequested: (feedback, channel) => feedbackRoute(feedback, channel),
    CliMcpRequested: (_, channel) =>
      Layer.launch(mcpServerLayer({ basePath: channel.environment.basePath })).pipe(Effect.scoped, Effect.orDie),
    CliServeRequested: (serve, channel) =>
      serveMutationServer(serveRequestOf(serve, channel.options)).pipe(Effect.scoped),
    CliRunRequested: (_, channel) => runStage(channel),
    CliSurvivorsRequested: (_, channel) => survivorsAdmissionCell.run(survivorsInputOf(channel)),
    CliRerunRequested: (rerun, channel) =>
      mutantRerunAdmissionCell.run(rerunInputOf(channel, rerun.ids)).pipe(
        Effect.tapError((failure) =>
          Effect.forEach(
            Option.toArray(Option.liftPredicate(failure, S.is(RerunRefused))),
            (refusal) => Effect.logError(refusal.reason),
            { discard: true },
          )
        ),
      ),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the CLI read resolved a command the route schema rejects: ${issue}` })),
  })
