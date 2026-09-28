import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, type Options, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import { McpProtocol, McpServer } from 'effect/unstable/ai'

import { ReproducerSchema } from '../build-reproducers.workflow.js'
import type { ConfigReadError } from '../ConfigError.schema.js'
import { recordFeedbackCell } from '../Feedback/Feedback.cell.js'
import { FeedbackUnusable } from '../Feedback/Feedback.schema.js'
import { readMutationReport, readSurfacedSurvivors } from '../Feedback/read-report.js'
import { ResolvedMode } from '../output-mode.schema.js'
import { MachineConsole } from '../reporting/machine-console.service.js'
import { mutantRerunAdmissionCell, RerunRefused } from '../Rerun/mod.js'
import { mutantDetailEventsOf } from '../Rerun/rerun-selection.js'
import type { MutationTestDone } from '../run/mutation-test.cell.js'
import { mutationTestCell } from '../run/run-stages.cell.js'
import { RunEnvironment, type RunEnvironmentShape } from '../run/RunEnvironment.service.js'
import type { EnginePorts } from '../run/StageServices.service.js'
import { StrykerPackage } from '../stryker-package.schema.js'
import { mcpToolkit } from './mcp-tools.js'
import { MutantDetail, MutantUnusable, RerunUnusable } from './mcp-tools.schema.js'

const MCP_RUN_ID = RunEvent.RunId.make('01ARZ3NDEKTSV4RRFFQ69G5FAM')

const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

const MCP_SERVER_INSTRUCTIONS =
  'Stryker mutation testing. Use list_survivors to read the surfaced survivors of the finished report, show_mutant to inspect one, rerun_mutant to re-run one through the run pipeline, and report_usefulness to record whether a survivor was worth acting on.'

const MCP_MODE = ResolvedMode.make({ mode: 'machine', signal: 'tool', stdoutIsTTY: false })

export interface McpServerOptions {
  readonly basePath: string
}

const readReproducers = (
  basePath: string,
): Effect.Effect<ReadonlyArray<typeof ReproducerSchema.Type>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const reproducerList = S.Array(ReproducerSchema).pipe(S.fromJsonString)
    const text = yield* fs.readFileString(path.resolve(basePath, REPRODUCERS_FILE)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    return Option.getOrElse(S.decodeOption(reproducerList)(text), () => [])
  })

const diffOf = (
  reproducers: ReadonlyArray<typeof ReproducerSchema.Type>,
  id: Mutant.MutantId,
): string | null =>
  Option.getOrElse(
    Option.map(Arr.findFirst(reproducers, (reproducer) => reproducer.id === id), (reproducer) => reproducer.diff),
    () => null,
  )

const readDiff = (
  basePath: string,
  id: Mutant.MutantId,
): Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> =>
  Effect.map(readReproducers(basePath), (reproducers) => diffOf(reproducers, id))

const mutantsOf = (report: Report.MutationTestResult): ReadonlyArray<Report.MutantResult> =>
  Arr.flatMap(Object.values(report.files), (file) => file.mutants)

const mutantAt = (
  report: Report.MutationTestResult,
  id: Mutant.MutantId,
): Option.Option<Report.MutantResult> => Arr.findFirst(mutantsOf(report), (mutant) => mutant.id === id)

const coveringTestsOf = (mutant: Report.MutantResult): ReadonlyArray<string> => [...(mutant.coveredBy ?? [])]

const killedByOf = (mutant: Report.MutantResult): string | null =>
  Option.getOrNull(Arr.head([...(mutant.killedBy ?? [])]))

const detailOf = (id: Mutant.MutantId, mutant: Report.MutantResult, diff: string | null): MutantDetail => ({
  id,
  status: mutant.status,
  coveringTests: coveringTestsOf(mutant),
  killedBy: killedByOf(mutant),
  reproducer: `stryker run --mutant ${id}`,
  diff,
})

const showMutant = (
  basePath: string,
  id: Mutant.MutantId,
): Effect.Effect<MutantDetail, MutantUnusable | FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const report = yield* readMutationReport(basePath)
    const found = yield* Effect.fromOption(mutantAt(report, id)).pipe(
      Effect.mapError(() => MutantUnusable.make({ id })),
    )
    const diff = yield* readDiff(basePath, id)
    return detailOf(id, found, diff)
  })

const restrictedOptionsOf = ({
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
} => ({
  ...resolvedOptions,
  mutate: [...mutateSpans],
  mutantIds: [...ids],
  incremental: true,
})

const runRestricted = (
  basePath: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<MutationTestDone, never, EnginePorts> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const environment: RunEnvironmentShape = {
      runId: MCP_RUN_ID,
      resolvedMode: MCP_MODE,
      runStartedAt: 0,
      basePath,
      builtinReporters: {},
      allowConsoleColors: false,
    }
    const runLayer = Layer.merge(
      RunEnvironment.stage(environment, queue),
      MachineConsole.captureLayer.pipe(Layer.provide(MachineConsole.layer)),
    )
    return yield* mutationTestCell
      .run({ cliOptions: options, targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.orDie)
  })

const NO_RESULTS: MutationTestDone = { results: [], verdict: null }

const resultsOf = (settled: void | MutationTestDone): ReadonlyArray<Mutant.RunMutantResult> =>
  (settled ?? NO_RESULTS).results

const reportedOf = (
  results: ReadonlyArray<Mutant.RunMutantResult>,
  id: Mutant.MutantId,
): Effect.Effect<RunEvent.MutantDetailReported, MutantUnusable> =>
  Effect.fromOption(Arr.head(mutantDetailEventsOf({ requested: Option.some([id]), results }))).pipe(
    Effect.mapError(() => MutantUnusable.make({ id })),
  )

const reasonOfRerun = (error: RerunRefused | ConfigReadError): string =>
  S.is(RerunRefused)(error) ? error.reason : error.message

const rerunFailureOf =
  (id: Mutant.MutantId) => (error: RerunRefused | ConfigReadError | MutantUnusable): MutantUnusable | RerunUnusable =>
    S.is(MutantUnusable)(error) ? error : RerunUnusable.make({ id, reason: reasonOfRerun(error) })

const rerunMutant = (
  basePath: string,
  id: Mutant.MutantId,
): Effect.Effect<MutantDetail, MutantUnusable | RerunUnusable, EnginePorts> =>
  Effect.gen(function*() {
    const settled = yield* mutantRerunAdmissionCell.run({
      ids: [id],
      cliOptions: {},
      mode: MCP_MODE.mode,
      basePath,
      settle: {
        runAdmitted: ({ ids, mutateSpans, resolvedOptions }) =>
          runRestricted(basePath, restrictedOptionsOf({ ids, mutateSpans, resolvedOptions })),
      },
    }).pipe(
      Effect.catchTag('SchemaError', Effect.die),
      Effect.mapError(rerunFailureOf(id)),
    )
    const reported = yield* reportedOf(resultsOf(settled), id)
    const diff = yield* readDiff(basePath, id)
    return {
      id: reported.id,
      status: reported.status,
      coveringTests: [...reported.coveringTests],
      killedBy: reported.killedBy,
      reproducer: reported.reproducer ?? `stryker run --mutant ${id}`,
      diff,
    }
  })

const handlers = (basePath: string) =>
  mcpToolkit.toLayer({
    list_survivors: () => readSurfacedSurvivors(basePath),
    show_mutant: ({ id }) => showMutant(basePath, id),
    rerun_mutant: ({ id }) => rerunMutant(basePath, id),
    report_usefulness: ({ id, judgment, reason }) =>
      recordFeedbackCell({ basePath, id, judgment, reason: reason ?? null }),
  })

export const mcpServerLayer = ({ basePath }: McpServerOptions) =>
  Layer.merge(
    McpServer.layerStdio({
      name: 'stryker',
      version: StrykerPackage.version,
      instructions: MCP_SERVER_INSTRUCTIONS,
      protocols: [McpProtocol.v2025_06_18],
    }),
    McpServer.toolkit(mcpToolkit),
  ).pipe(
    Layer.provide(handlers(basePath)),
    Layer.provide(MachineConsole.layer),
  )
