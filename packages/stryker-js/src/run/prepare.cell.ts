import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { RunEvent, SpanTaxonomy, StockCatalog } from '@systemfsoftware/stryker-js-cli-contract'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import {
  MutatorCatalog,
  Options,
  type Reporter as InterfaceReporter,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean, Schema as S } from 'effect'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'

import {
  decodeMutatorSelection,
  DecodeMutatorSelectionCommand,
  type MutatorSelectionDecoded,
} from '../decode-mutator-selection.workflow.js'
import { installedFrameworkClaimants } from '../framework-claimant.service.js'
import {
  type MergedCatalog,
  planMutatorCatalogs,
  PlanMutatorCatalogsCommand,
} from '../plan-mutator-catalogs.workflow.js'
import { pluginLoadPhaseEvent, reportPluginLoad } from '../plugin-load-report.service.js'
import { loadPlugins, pluginUrlsFromOptions } from '../plugin-loader.service.js'
import { type LoadedPlugins, type PluginDescriptor } from '../Plugins.schema.js'
import type { Project } from '../Project.schema.js'
import type { ReadProjectDone } from '../read-project.cell.js'
import {
  attachReporterFactories,
  currentReporterInit,
  type PhaseSpan,
  type ReporterStage,
  validateReporterNames,
  withPhaseSpan,
} from '../reporter-stream.service.js'
import { type ReporterChoice, reporterInputsOf } from '../reporter-wiring.service.js'
import { Reporter } from '../reporter.service.js'
import { AnsiCode } from '../reporting/ansi.schema.js'
import { RunEvents } from '../run-events.service.js'
import { RunFailure } from '../Run.schema.js'
import { TemporaryDirectory } from '../Sandbox.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { admitNonEmptyProject, NonEmptyProjectCommand, ProjectEmpty } from './admit-non-empty-project.workflow.js'
import type { FrameworkClaimant } from './explain-file-skip.workflow.js'
import type { ValidationSchemaDocument } from './load-config.cell.js'
import { forkCoreSchema } from './load-config.js'
import { planPrepare, PrepareDecoded } from './plan-prepare.workflow.js'
import { planReporters, ReporterPlanCommand } from './plan-reporters.workflow.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'
import { validateOptions } from './validate-options.js'

const announceSummary = Effect.fn(SpanTaxonomy.Spans.prepareAnnounceSummary.name)(
  function*(input: { readonly env: RunEnvironmentShape; readonly summary: string }) {
    yield* Match.value(input.env.resolvedMode.mode).pipe(
      Match.when('human', () =>
        Boolean.match(input.env.allowConsoleColors, {
          onTrue: () => Console.log(`${AnsiCode.fields.green.literal}${input.summary}${AnsiCode.fields.reset.literal}`),
          onFalse: () => Console.log(input.summary),
        })),
      Match.orElse(() => Effect.logInfo(input.summary)),
    )
  },
)

export interface PrepareDone {
  readonly project: Project
  readonly loadedPlugins: LoadedPlugins
  readonly ignorers: readonly Ignorer[]
  readonly mutatorCatalogs: readonly MergedCatalog[]
  readonly mutatorSelection: MutatorSelectionDecoded
  readonly formatRegistry: Format.FormatRegistry
  readonly options: Options.StrykerOptions
  readonly temporaryDirectoryPath: string
  readonly reporterStage: ReporterStage
  readonly frameworkClaimants: readonly FrameworkClaimant[]
}

export interface PrepareExecutorArgs {
  cliOptions: Options.PartialStrykerOptions
  targetMutatePatterns: string[] | undefined
}

type PrepareRaw = typeof PrepareDecoded.Encoded & {
  readonly now: number
  readonly env: RunEnvironmentShape
  readonly queue: Queue.Queue<RunEvent.RunEvent, Cause.Done>
  readonly options: Options.StrykerOptions
  readonly loaded: LoadedPlugins
  readonly project: Project
  readonly ignorers: readonly Ignorer[]
  readonly mutatorCatalogs: readonly MergedCatalog[]
  readonly mutatorSelection: MutatorSelectionDecoded
  readonly formatRegistry: Format.FormatRegistry
  readonly builtinReporterFactories: Record<string, InterfaceReporter.ReporterFactory>
  readonly reporterChoicesByName: HashMap.HashMap<string, ReporterChoice>
  readonly frameworkClaimants: readonly FrameworkClaimant[]
}

const NO_PLUGIN_DESCRIPTORS: readonly PluginDescriptor[] = []

const schemaPropertiesOf = <A = unknown>(document: ValidationSchemaDocument<A>): Record<string, NonNullable<A>> =>
  Option.getOrElse(Option.fromNullishOr(document.properties), () => ({}))

const buildMergedSchema = <A = unknown>(
  core: ValidationSchemaDocument,
  contributions: readonly Record<string, A>[],
): ValidationSchemaDocument =>
  contributions.reduce(
    (merged, contribution) => ({
      ...merged,
      properties: { ...schemaPropertiesOf(merged), ...schemaPropertiesOf(contribution) },
    }),
    core,
  )

const publishResolvedOptions = (
  env: RunEnvironmentShape,
  options: Options.StrykerOptions,
): Effect.Effect<void> =>
  Option.match(Option.fromUndefinedOr(env.resolvedOptions), {
    onNone: () => Effect.void,
    onSome: (resolved) => Ref.set(resolved, options),
  })

const readPrepare = Effect.fn(SpanTaxonomy.Spans.prepareGather.name)(function*(
  command: ReadProjectDone,
): Effect.fn.Return<
  PrepareRaw,
  RunFailure,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> {
  yield* Scope.Scope
  const env = yield* RunEnvironment
  const queue = yield* RunEvents
  const coreSchema: ValidationSchemaDocument = forkCoreSchema
  const configured = command.options
  const plannedReporters = planReporters(
    ReporterPlanCommand.make({ configured: [...configured.reporters], mode: env.resolvedMode.mode }),
  )
  const resolvedReporters = Option.getOrElse(
    Option.map(Result.getSuccess(plannedReporters), (decision) => [...decision.reporters]),
    () => [...configured.reporters],
  )
  const options: Options.StrykerOptions = {
    ...configured,
    reporters: resolvedReporters,
    allowConsoleColors: env.allowConsoleColors,
    clearTextReporter: {
      ...configured.clearTextReporter,
      allowColor: env.allowConsoleColors,
    },
  }
  yield* publishResolvedOptions(env, options)
  const descriptors: readonly string[] = pluginUrlsFromOptions(options)
  const loaded = yield* loadPlugins(descriptors, env.basePath).pipe(
    Effect.tapError(() =>
      Clock.currentTimeMillis.pipe(
        Effect.map((failedAt) => pluginLoadPhaseEvent(failedAt - env.runStartedAt)),
        Effect.flatMap((event) => Queue.offer(queue, event)),
      )
    ),
    Effect.mapError((cause) => RunFailure.make({ evidence: cause.evidence, detail: 'Failed to load plugins', cause })),
  )
  const stockCatalog = yield* Effect.orDie(S.decodeEffect(MutatorCatalog.Catalog)(StockCatalog.StockCatalog))
  const providers = loaded.mutators.map((provider) => ({
    moduleName: provider.moduleName,
    namespace: provider.contribution.namespace,
    entries: provider.contribution.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      tier: entry.tier,
      definition: entry.definition,
      examples: [...entry.examples],
    })),
  }))
  const plannedCatalogs = yield* Effect.fromResult(
    Result.mapError(
      planMutatorCatalogs(PlanMutatorCatalogsCommand.make({ stock: stockCatalog, providers })),
      (refused) => {
        const detail = refused.message
        return RunFailure.make({
          evidence: { _tag: 'ConfigInvalid', stage: 'config', detail },
          detail,
          cause: refused,
        })
      },
    ),
  )
  const mutatorCatalogs = plannedCatalogs.catalogs
  const mutatorSelection = yield* Effect.fromResult(
    Result.mapError(
      decodeMutatorSelection(
        DecodeMutatorSelectionCommand.make({
          catalogs: [...mutatorCatalogs],
          excludedMutations: [...options.mutator.excludedMutations],
          optInMutations: [...options.mutator.optInMutations],
        }),
      ),
      (refused) => {
        const detail = refused.message
        return RunFailure.make({
          evidence: { _tag: 'ConfigInvalid', stage: 'config', detail },
          detail,
          cause: refused,
        })
      },
    ),
  )
  const registry = Format.registerEntries(
    Format.coreFormatRegistry,
    loaded.frameworks.map(({ moduleName, framework }) => Format.frameworkEntryOf(moduleName, framework)),
  )
  yield* reportPluginLoad(queue, loaded, registry)
  const mergedSchema = buildMergedSchema(coreSchema, loaded.schemaContributions)
  const record = { ...options }
  yield* validateOptions(record, mergedSchema).pipe(
    Effect.mapError(
      (cause) => {
        const detail = 'Failed to revalidate options with plugin schema'
        return RunFailure.make({
          evidence: { _tag: 'ConfigInvalid', stage: 'config', detail },
          detail,
          cause,
        })
      },
    ),
  )
  const ignorers: readonly Ignorer[] = loaded.ignorers

  const builtinReporterFactories: Record<string, InterfaceReporter.ReporterFactory> = {
    ...(yield* Reporter).builtin,
    ...env.builtinReporters,
  }
  const pluginReporterDescriptors = Option.getOrElse(
    HashMap.get(loaded.pluginsByKind, 'Reporter'),
    () => NO_PLUGIN_DESCRIPTORS,
  )
  const reporterChoicesByName = HashMap.fromIterable<string, ReporterChoice>([
    ...Object.entries(builtinReporterFactories).map(
      ([name, factory]) => [name.toLowerCase(), { name, builtinFactory: Option.some(factory) }] as const,
    ),
    ...pluginReporterDescriptors.map(
      (descriptor) =>
        [
          descriptor.name.toLowerCase(),
          { name: descriptor.name, builtinFactory: Option.none<InterfaceReporter.ReporterFactory>() },
        ] as const,
    ),
  ])
  const frameworkClaimants = yield* installedFrameworkClaimants(env.basePath)
  const now = yield* Clock.currentTimeMillis
  return {
    now,
    mode: env.resolvedMode.mode,
    reporters: [...options.reporters],
    fileCount: pipe(command.project.files, MutableHashMap.size),
    env,
    queue,
    options,
    loaded,
    project: command.project,
    ignorers,
    mutatorCatalogs,
    mutatorSelection,
    formatRegistry: registry,
    builtinReporterFactories,
    reporterChoicesByName,
    frameworkClaimants,
  }
})

const applyPrepare = Effect.fn(SpanTaxonomy.Spans.prepareApply.name)(function*(
  span: PhaseSpan,
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.fn.Return<PrepareDone, RunFailure, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> {
  const mutateCount = pipe(raw.project.filesToMutate, MutableHashMap.size)
  yield* announceSummary({
    env: raw.env,
    summary: `Found ${mutateCount} of ${pipe(raw.project.files, MutableHashMap.size)} file(s) to be mutated.`,
  })
  yield* validateReporterNames(
    raw.options.reporters,
    [...HashMap.values(raw.reporterChoicesByName)].map((choice) => choice.name),
  ).pipe(
    Effect.mapError((cause) => {
      const detail = cause.message
      return RunFailure.make({
        evidence: { _tag: 'ConfigInvalid', stage: 'config', detail },
        detail,
        cause,
      })
    }),
  )
  const admission = admitNonEmptyProject(
    NonEmptyProjectCommand.make({ fileCount: pipe(raw.project.files, MutableHashMap.size) }),
  )
  const emptyAdmission = Option.filter(Result.getSuccess(admission), S.is(ProjectEmpty))
  const emptyProjectGuard: Result.Result<void, RunFailure> = Option.getOrElse(
    Option.map(
      emptyAdmission,
      (): Result.Result<void, RunFailure> =>
        Result.fail(
          RunFailure.make({
            evidence: { _tag: 'NoInputFiles', stage: 'prepare' },
            detail: 'No input files found.',
          }),
        ),
    ),
    (): Result.Result<void, RunFailure> => Result.succeed(undefined),
  )
  yield* Effect.fromResult(emptyProjectGuard)
  const temporaryDirectoryPath = yield* Effect.map(
    Layer.build(TemporaryDirectory.layer(raw.options)),
    (temporaryDirectory) => Context.get(temporaryDirectory, TemporaryDirectory).path,
  ).pipe(
    Effect.mapError((cause) =>
      RunFailure.make({
        evidence: { _tag: 'SandboxPreparationFailed', stage: 'prepare' },
        detail: 'Failed to create temporary directory',
        cause,
      })
    ),
  )
  const reporterInputs = yield* reporterInputsOf(
    reporters,
    raw.reporterChoicesByName,
    raw.loaded,
    raw.env.basePath,
    raw.options,
  )
  const reporterInit = yield* currentReporterInit(span)
  const reporterStage = yield* attachReporterFactories(reporterInputs, raw.options, reporterInit)
  const { now } = raw
  yield* Queue.offer(raw.queue, RunEvent.PhaseEntered.make({ phase: 'prepare', elapsedMs: now - raw.env.runStartedAt }))
  return {
    project: raw.project,
    loadedPlugins: raw.loaded,
    ignorers: raw.ignorers,
    mutatorCatalogs: raw.mutatorCatalogs,
    mutatorSelection: raw.mutatorSelection,
    formatRegistry: raw.formatRegistry,
    options: raw.options,
    temporaryDirectoryPath,
    reporterStage,
    frameworkClaimants: raw.frameworkClaimants,
  }
})

const writePrepare = (
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.Effect<PrepareDone, RunFailure, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  withPhaseSpan(SpanTaxonomy.Spans.preparePhase, {}, (span) => applyPrepare(span, reporters, raw))

export const prepareCell: Cell.Cell<
  ReadProjectDone,
  PrepareDone,
  RunFailure,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> = Sandwich.named(SpanTaxonomy.Spans.prepare.name)(readPrepare)
  .decide(planPrepare)
  .write({
    HumanReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    MachineReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    CommandRejected: ({ issue }) =>
      Effect.fail(RunFailure.make({ evidence: { _tag: 'InvariantBroken', stage: 'prepare' }, detail: issue })),
  })
