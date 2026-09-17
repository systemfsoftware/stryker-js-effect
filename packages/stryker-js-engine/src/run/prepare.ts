import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { type ReporterFactory, type StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { PhaseEntered } from '@systemfsoftware/stryker-js-language'
import { RunEvents } from '@systemfsoftware/stryker-js-language'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-language'
import { makeBuiltinReporterFactories } from '../builtin-reporters.js'
import { forkCoreSchema, readConfig, validateOptions } from '../Config.js'
import type { ValidationSchemaDocument } from '../Config.js'
import { resolvePluginWorkerEntry } from '../plugin-worker-entry.js'
import { missingWorkerEntry } from '../plugin-worker-entry.js'
import { loadPlugins } from '../Plugins.js'
import type { LoadedPlugins, PluginDescriptor } from '../Plugins.js'
import { readProject } from '../Project.js'
import type { Project } from '../Project.js'
import { ansi } from '../Reporter.ansi.js'
import {
  attachReporterFactories,
  type AttachReporterInput,
  currentReporterInit,
  type ReporterStage,
  reporterWorkerFactory,
  spawnReporterWorker,
  validateReporterNames,
  withPhaseSpan,
} from '../ReporterStream.js'
import { PrepareError, StageError } from '../Run.schema.js'
import { TemporaryDirectory, TemporaryDirectoryLive } from '../Sandbox.js'
import { selectReporters } from '../select-reporters.js'
import { WorkerLauncher } from '../WorkerLauncher.js'
import { RunEnvironment } from './RunEnvironment.js'
import type { RunEnvironmentShape } from './RunEnvironment.js'

export interface PrepareDone {
  readonly project: Project
  readonly loadedPlugins: LoadedPlugins
  readonly ignorers: readonly Ignorer[]
  readonly options: StrykerOptions
  readonly temporaryDirectoryPath: string
  readonly reporterStage: ReporterStage
}

export interface PrepareExecutorArgs {
  cliOptions: PartialStrykerOptions
  targetMutatePatterns: string[] | undefined
}

const isRecord = Predicate.isObject

const asRecord = (value: unknown): Record<string, unknown> =>
  Match.value(value).pipe(
    Match.when(isRecord, (record) => Object.fromEntries(Object.entries(record))),
    Match.orElse((): Record<string, unknown> => ({})),
  )

const schemaPropertiesOf = (document: unknown): Record<string, unknown> => asRecord(asRecord(document)['properties'])

const buildMergedSchema = (
  core: ValidationSchemaDocument,
  contributions: readonly Record<string, unknown>[],
): ValidationSchemaDocument =>
  Match.value(contributions.length === 0).pipe(
    Match.when(true, (): ValidationSchemaDocument => core),
    Match.orElse((): ValidationSchemaDocument => ({
      ...core,
      properties: Object.assign(
        {},
        schemaPropertiesOf(core),
        ...contributions.map((contribution) => schemaPropertiesOf(contribution)),
      ),
    })),
  )

interface ReporterChoice {
  readonly name: string
  readonly builtinFactory: Option.Option<ReporterFactory>
}

const announceSummary = (env: RunEnvironmentShape, summary: string): Effect.Effect<void> =>
  Match.value(env.resolvedMode.mode).pipe(
    Match.when('human', () => announceHumanSummary(env.allowConsoleColors, summary)),
    Match.orElse(() => Effect.logInfo(summary)),
  )

const announceHumanSummary = (allowConsoleColors: boolean, summary: string): Effect.Effect<void> =>
  Match.value(allowConsoleColors).pipe(
    Match.when(true, () => Console.log(ansi.green(summary))),
    Match.orElse(() => Console.log(summary)),
  )

const selectReporter = (
  chosen: Map<string, ReporterChoice>,
  name: string,
  choicesByName: HashMap.HashMap<string, ReporterChoice>,
): void => {
  const key = name.toLowerCase()
  Option.match(HashMap.get(choicesByName, key), {
    onNone: () => undefined,
    onSome: (choice) => {
      if (!chosen.has(key)) {
        chosen.set(key, choice)
      }
    },
  })
}

const reporterChoicesOf = (
  names: readonly string[],
  choicesByName: HashMap.HashMap<string, ReporterChoice>,
): readonly ReporterChoice[] => {
  const chosen = new Map<string, ReporterChoice>()
  names.forEach((name) => selectReporter(chosen, name, choicesByName))
  return [...chosen.values()]
}

const NO_PLUGIN_DESCRIPTORS: readonly PluginDescriptor[] = []

const spawnPluginReporterFactory = (
  name: string,
  loaded: LoadedPlugins,
  projectBasePath: string,
  options: StrykerOptions,
): Effect.Effect<
  ReporterFactory,
  StageError,
  Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const entry = yield* resolvePluginWorkerEntry({ loaded, kind: 'Reporter', name }).pipe(
      Effect.mapError(missingWorkerEntry('prepare', 'reporter', name)),
    )
    const client = yield* spawnReporterWorker({
      entrypoint: entry.entrypoint,
      projectBasePath,
      execArgv: [],
      options,
      tempDirPrefix: 'stryker-reporter-',
    }).pipe(
      Effect.mapError((cause) =>
        new StageError({ stage: 'prepare', reason: `Failed to start the reporter worker "${name}"`, cause })
      ),
    )
    return reporterWorkerFactory(client)
  })

const reporterInputsOf = (
  names: readonly string[],
  choicesByName: HashMap.HashMap<string, ReporterChoice>,
  loaded: LoadedPlugins,
  projectBasePath: string,
  options: StrykerOptions,
): Effect.Effect<
  readonly AttachReporterInput[],
  StageError,
  Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Effect.forEach(
    reporterChoicesOf(names, choicesByName),
    (choice) =>
      Option.match(choice.builtinFactory, {
        onSome: (builtin) => Effect.succeed<AttachReporterInput>({ name: choice.name, factory: builtin }),
        onNone: () =>
          Effect.map(
            spawnPluginReporterFactory(choice.name, loaded, projectBasePath, options),
            (factory): AttachReporterInput => ({ name: choice.name, factory }),
          ),
      }),
    { concurrency: 1 },
  )

export const runPrepare = (command: PrepareExecutorArgs) =>
  withPhaseSpan(
    'prepare',
    {},
    (span) =>
      Effect.gen(function*() {
        yield* Scope.Scope
        const env = yield* RunEnvironment
        const queue = yield* RunEvents
        const coreSchema: ValidationSchemaDocument = forkCoreSchema
        const configured = yield* readConfig(command.cliOptions).pipe(
          Effect.mapError((cause) => new StageError({ stage: 'prepare', reason: 'Failed to read config', cause })),
          Effect.tapCause(() =>
            Effect.gen(function*() {
              const now = yield* Clock.currentTimeMillis
              yield* Queue.offer(queue, new PhaseEntered({ phase: 'prepare', elapsedMs: now - env.runStartedAt }))
            }).pipe(Effect.ignore)
          ),
        )
        const resolvedReporters = selectReporters([...configured.reporters], env.resolvedMode.mode)
        const options: PrepareDone['options'] = {
          ...configured,
          reporters: resolvedReporters,
          allowConsoleColors: env.allowConsoleColors,
          clearTextReporter: {
            ...configured.clearTextReporter,
            allowColor: env.allowConsoleColors,
          },
        }
        const descriptors: readonly string[] = [...options.plugins, ...options.appendPlugins]
        const loaded = yield* loadPlugins(descriptors).pipe(
          Effect.mapError((cause) => new StageError({ stage: 'prepare', reason: 'Failed to load plugins', cause })),
        )
        const mergedSchema = buildMergedSchema(coreSchema, loaded.schemaContributions)
        const record: Record<string, unknown> = { ...options }
        yield* validateOptions(record, mergedSchema).pipe(
          Effect.mapError(
            (cause) =>
              new StageError({
                stage: 'prepare',
                reason: 'Failed to revalidate options with plugin schema',
                cause,
              }),
          ),
        )
        const project = yield* readProject(options, command.targetMutatePatterns, env.basePath).pipe(
          Effect.mapError((cause) => new StageError({ stage: 'prepare', reason: 'Failed to read project', cause })),
        )
        const mutateCount = MutableHashMap.size(project.filesToMutate)
        const summary = `Found ${mutateCount} of ${MutableHashMap.size(project.files)} file(s) to be mutated.`
        yield* announceSummary(env, summary)
        const selectedIgnorers = HashSet.fromIterable(options.ignorers)
        const ignorers: readonly Ignorer[] = loaded.ignorers.filter((ignorer) =>
          HashSet.has(selectedIgnorers, ignorer.name)
        )
        const temporaryDirectoryPath = yield* Effect.gen(function*() {
          const live = TemporaryDirectoryLive(options)
          const service = yield* Effect.service(TemporaryDirectory).pipe(Effect.provide(live))
          return service.path
        }).pipe(
          Effect.mapError((cause) =>
            new StageError({ stage: 'prepare', reason: 'Failed to create temporary directory', cause })
          ),
        )
        const builtinReporterFactories = {
          ...makeBuiltinReporterFactories({
            fileSystem: yield* FileSystem.FileSystem,
            path: yield* Path.Path,
          }),
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
                { name: descriptor.name, builtinFactory: Option.none<ReporterFactory>() },
              ] as const,
          ),
        ])
        const availableReporterNames = [...HashMap.values(reporterChoicesByName)].map((choice) => choice.name)
        yield* validateReporterNames(configured.reporters, availableReporterNames).pipe(
          Effect.mapError((cause) => new StageError({ stage: 'prepare', reason: cause.message, cause })),
        )
        const reporterInputs = yield* reporterInputsOf(
          options.reporters,
          reporterChoicesByName,
          loaded,
          env.basePath,
          options,
        )
        const reporterInit = yield* currentReporterInit(span)
        const reporterStage = yield* attachReporterFactories(reporterInputs, options, reporterInit)
        const now = yield* Clock.currentTimeMillis
        yield* Queue.offer(queue, new PhaseEntered({ phase: 'prepare', elapsedMs: now - env.runStartedAt }))
        if (MutableHashMap.size(project.files) === 0) {
          return yield* Effect.fail(
            new StageError({
              stage: 'prepare',
              reason: 'No input files found.',
              cause: new PrepareError({ stage: 'prepare', reason: 'No input files found.' }),
            }),
          )
        }
        return {
          project,
          loadedPlugins: loaded,
          ignorers,
          options,
          temporaryDirectoryPath,
          reporterStage,
        }
      }),
  )
