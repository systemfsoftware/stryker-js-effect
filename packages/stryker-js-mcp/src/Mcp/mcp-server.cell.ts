import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Configuration } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Engine } from '@systemfsoftware/stryker-js-engine'
import { Mutant, type Options, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Survivors } from '@systemfsoftware/stryker-js-survivors'
import { McpProtocol, McpServer } from 'effect/ai'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import { captureLayer as machineConsoleCaptureLayer, layer as machineConsoleLayer } from '../drivers/machine-console.js'
import { mcpToolkit } from './mcp-tools.js'
import { MutantDetail, MutantUnusable, RerunUnusable } from './mcp-tools.schema.js'

const MCP_RUN_ID = RunEvent.RunId.make('01ARZ3NDEKTSV4RRFFQ69G5FAM')

const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

const MCP_SERVER_INSTRUCTIONS =
  'Stryker mutation testing. Use list_survivors to read the surfaced survivors of the finished report, show_mutant to inspect one, rerun_mutant to re-run one through the run pipeline, and report_usefulness to record whether a survivor was worth acting on.'

const MCP_MODE = Run.ResolvedMode.make({ mode: 'machine', signal: 'tool', stdoutIsTTY: false })

export interface McpServerOptions {
  readonly basePath: string
  readonly configOverlay: Configuration.ConfigOverlay
}

const readReproducers = (
  basePath: string,
): Effect.Effect<ReadonlyArray<typeof Engine.ReproducerSchema.Type>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const reproducerList = S.Array(Engine.ReproducerSchema).pipe(S.fromJsonString)
    const text = yield* fs.readFileString(path.resolve(basePath, REPRODUCERS_FILE)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    return Option.getOrElse(S.decodeOption(reproducerList)(text), () => [])
  })

const diffOf = (
  reproducers: ReadonlyArray<typeof Engine.ReproducerSchema.Type>,
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
): Effect.Effect<MutantDetail, MutantUnusable | Reports.FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const report = yield* Survivors.readMutationReport(basePath)
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
  configOverlay: Configuration.ConfigOverlay,
  options: Options.PartialStrykerOptions,
): Effect.Effect<Reports.MutationTestDone, never, Engine.EnginePorts> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const environment: Run.RunEnvironmentShape = {
      runId: MCP_RUN_ID,
      resolvedMode: MCP_MODE,
      runStartedAt: 0,
      basePath,
      builtinReporters: {},
      configOverlay,
      allowConsoleColors: false,
    }
    const runLayer = Layer.merge(
      Engine.stage(environment, queue),
      machineConsoleCaptureLayer.pipe(Layer.provide(machineConsoleLayer)),
    )
    return yield* Engine.mutationTestCell
      .run({ cliOptions: options, targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.orDie)
  })

const NO_RESULTS: Reports.MutationTestDone = { results: [], verdict: null }

const resultsOf = (settled: void | Reports.MutationTestDone): ReadonlyArray<Mutant.RunMutantResult> =>
  (settled ?? NO_RESULTS).results

const reportedOf = (
  results: ReadonlyArray<Mutant.RunMutantResult>,
  id: Mutant.MutantId,
): Effect.Effect<RunEvent.MutantDetailReported, MutantUnusable> =>
  Effect.fromOption(Arr.head(Engine.mutantDetailEventsOf({ requested: Option.some([id]), results }))).pipe(
    Effect.mapError(() => MutantUnusable.make({ id })),
  )

const reasonOfRerun = (error: Survivors.RerunRefused | Configuration.ConfigReadError): string =>
  S.is(Survivors.RerunRefused)(error) ? error.reason : error.message

const rerunFailureOf =
  (id: Mutant.MutantId) =>
  (error: Survivors.RerunRefused | Configuration.ConfigReadError | MutantUnusable): MutantUnusable | RerunUnusable =>
    S.is(MutantUnusable)(error) ? error : RerunUnusable.make({ id, reason: reasonOfRerun(error) })

const rerunMutant = (
  { basePath, configOverlay }: McpServerOptions,
  id: Mutant.MutantId,
): Effect.Effect<MutantDetail, MutantUnusable | RerunUnusable, Engine.EnginePorts> =>
  Effect.gen(function*() {
    const settled = yield* Survivors.mutantRerunAdmissionCell.run({
      ids: [id],
      cliOptions: {},
      mode: MCP_MODE.mode,
      configOverlay,
      basePath,
      settle: {
        runAdmitted: ({ ids, mutateSpans, resolvedOptions }) =>
          runRestricted(basePath, configOverlay, restrictedOptionsOf({ ids, mutateSpans, resolvedOptions })),
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

const handlers = (options: McpServerOptions) =>
  mcpToolkit.toLayer({
    list_survivors: () => Survivors.readSurfacedSurvivors(options.basePath),
    show_mutant: ({ id }) => showMutant(options.basePath, id),
    rerun_mutant: ({ id }) => rerunMutant(options, id),
    report_usefulness: ({ id, judgment, reason }) =>
      Survivors.recordFeedbackCell({ basePath: options.basePath, id, judgment, reason: reason ?? null }),
  })

const serverLayer = Layer.unwrap(
  Effect.gen(function*() {
    const { framework } = yield* Run.EngineIdentity
    return McpServer.layerStdio({
      name: 'stryker',
      version: framework.version,
      instructions: MCP_SERVER_INSTRUCTIONS,
      protocols: [McpProtocol.v2025_06_18],
    })
  }),
)

export const mcpServerLayer = (options: McpServerOptions) =>
  Layer.merge(serverLayer, McpServer.toolkit(mcpToolkit)).pipe(
    Layer.provide(handlers(options)),
    Layer.provide(machineConsoleLayer),
  )
