import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, type Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import { installedFrameworkClaimants } from '../framework-claimant.service.js'
import { pluginLoadFailureEvents, reportPluginLoad } from '../plugin-load-report.service.js'
import { loadPlugins, pluginUrlsFromOptions } from '../plugin-loader.service.js'
import { type LoadedPlugins, type PluginDescriptor } from '../Plugins.schema.js'
import type { Project } from '../Project.schema.js'
import type { ReadProjectDone } from '../read-project.cell.js'
import {
  attachReporterFactories,
  currentReporterInit,
  type ReporterStage,
  validateReporterNames,
  withPhaseSpan,
} from '../reporter-stream.service.js'
import { type ReporterChoice, reporterInputsOf } from '../reporter-wiring.service.js'
import { Reporter } from '../reporter.service.js'
import { type RunEvent } from '../run-events.service.js'
import { PhaseEntered, RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { TemporaryDirectory } from '../Sandbox.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import type { FrameworkClaimant } from './explain-file-skip.workflow.js'
import { forkCoreSchema, validateOptions } from './load-config.cell.js'
import type { ValidationSchemaDocument } from './load-config.cell.js'
import { planPrepare, PrepareDecoded } from './plan-prepare.workflow.js'
import { announceSummary, failOnEmptyProject, selectReporters } from './prepare.parts.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'

export interface PrepareDone {
  readonly project: Project
  readonly loadedPlugins: LoadedPlugins
  readonly ignorers: readonly Ignorer[]
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
  readonly queue: Queue.Queue<RunEvent, Cause.Done>
  readonly options: Options.StrykerOptions
  readonly loaded: LoadedPlugins
  readonly project: Project
  readonly ignorers: readonly Ignorer[]
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

const readPrepare = (command: ReadProjectDone): Effect.Effect<
  PrepareRaw,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const env = yield* RunEnvironment
    const queue = yield* RunEvents
    const coreSchema: ValidationSchemaDocument = forkCoreSchema
    const configured = command.options
    const resolvedReporters = selectReporters([...configured.reporters], env.resolvedMode.mode)
    const options: Options.StrykerOptions = {
      ...configured,
      reporters: resolvedReporters,
      allowConsoleColors: env.allowConsoleColors,
      clearTextReporter: {
        ...configured.clearTextReporter,
        allowColor: env.allowConsoleColors,
      },
    }
    const descriptors: readonly string[] = pluginUrlsFromOptions(options)
    const loaded = yield* loadPlugins(descriptors, env.basePath).pipe(
      Effect.tapError((error) =>
        Effect.gen(function*() {
          const failedAt = yield* Clock.currentTimeMillis
          const events = yield* pluginLoadFailureEvents(error, failedAt - env.runStartedAt)
          yield* Effect.forEach(events, (event) => Queue.offer(queue, event), { discard: true })
        })
      ),
      Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: 'Failed to load plugins', cause })),
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
        (cause) =>
          StageError.make({
            stage: 'prepare',
            reason: 'Failed to revalidate options with plugin schema',
            cause,
          }),
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
      availableReporters: [...HashMap.values(reporterChoicesByName)].map((choice) => choice.name),
      env,
      queue,
      options,
      loaded,
      project: command.project,
      ignorers,
      formatRegistry: registry,
      builtinReporterFactories,
      reporterChoicesByName,
      frameworkClaimants,
    }
  })

const writePrepare = (
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.Effect<PrepareDone, StageError, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  withPhaseSpan(
    'prepare',
    {},
    (span) =>
      Effect.gen(function*() {
        const mutateCount = pipe(raw.project.filesToMutate, MutableHashMap.size)
        yield* announceSummary({
          env: raw.env,
          summary: `Found ${mutateCount} of ${pipe(raw.project.files, MutableHashMap.size)} file(s) to be mutated.`,
        })
        yield* validateReporterNames(
          raw.options.reporters,
          [...HashMap.values(raw.reporterChoicesByName)].map((choice) => choice.name),
        ).pipe(
          Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: cause.message, cause })),
        )
        yield* failOnEmptyProject(pipe(raw.project.files, MutableHashMap.size))
        const temporaryDirectoryPath = yield* Effect.map(
          Layer.build(TemporaryDirectory.layer(raw.options)),
          (temporaryDirectory) => Context.get(temporaryDirectory, TemporaryDirectory).path,
        ).pipe(
          Effect.mapError((cause) =>
            StageError.make({ stage: 'prepare', reason: 'Failed to create temporary directory', cause })
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
        yield* Queue.offer(raw.queue, PhaseEntered.make({ phase: 'prepare', elapsedMs: now - raw.env.runStartedAt }))
        return {
          project: raw.project,
          loadedPlugins: raw.loaded,
          ignorers: raw.ignorers,
          formatRegistry: raw.formatRegistry,
          options: raw.options,
          temporaryDirectoryPath,
          reporterStage,
          frameworkClaimants: raw.frameworkClaimants,
        }
      }),
  )

export const prepareCell: Cell.Cell<
  ReadProjectDone,
  PrepareDone,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> = Sandwich.named('stryker.prepare')(readPrepare)
  .decide(planPrepare)
  .write({
    HumanReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    MachineReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'prepare', reason: issue })),
  })
