import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { type ReporterFactory, type StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import { dual } from 'effect/Function'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import { type RunEvent } from '../run-events.service.js'
import { PhaseEntered } from '../run-events.service.js'
import { RunEvents } from '../run-events.service.js'

import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { loadPlugins, pluginUrlsFromOptions, type LoadedPlugins, type PluginDescriptor } from '../Plugins.js'
import { missingWorkerEntry, resolvePluginWorkerEntry } from '../plugin-worker-entry.js'
import type { ReadProjectDone } from '../read-project.cell.js'
import type { Project } from '../Project.schema.js'
import { Reporter } from '../reporter.service.js'
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
} from '../reporter-stream.service.js'
import { PrepareError, StageError } from '../Run.schema.js'
import { TemporaryDirectory } from '../Sandbox.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { forkCoreSchema, validateOptions } from './load-config.cell.js'
import type { ValidationSchemaDocument } from './load-config.cell.js'
import { planPrepare, PrepareDecoded } from './plan-prepare.workflow.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'

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

type PrepareRaw = typeof PrepareDecoded.Encoded & {
  readonly env: RunEnvironmentShape
  readonly queue: Queue.Queue<RunEvent, Cause.Done>
  readonly options: StrykerOptions
  readonly loaded: LoadedPlugins
  readonly project: Project
  readonly ignorers: readonly Ignorer[]
  readonly builtinReporterFactories: Record<string, ReporterFactory>
  readonly reporterChoicesByName: HashMap.HashMap<string, ReporterChoice>
}

const schemaPropertiesOf = <A = unknown>(document: ValidationSchemaDocument<A>): Record<string, NonNullable<A>> =>
  Option.getOrElse(Option.fromNullishOr(document.properties), () => ({}))

const buildMergedSchema = <A = unknown>(
  core: ValidationSchemaDocument,
  contributions: readonly Record<string, A>[],
) =>
  Boolean.match(contributions.length === 0, {
    onTrue: () => core,
    onFalse: () => ({
      ...core,
      properties: Object.assign(
        {},
        schemaPropertiesOf(core),
        ...contributions.map((contribution) => schemaPropertiesOf(contribution)),
      ),
    }),
  })

interface ReporterChoice {
  readonly name: string
  readonly builtinFactory: Option.Option<ReporterFactory>
}

const announceSummary = (env: RunEnvironmentShape, summary: string) =>
  Match.value(env.resolvedMode.mode).pipe(
    Match.when('human', () => announceHumanSummary(env.allowConsoleColors, summary)),
    Match.orElse(() => Effect.logInfo(summary)),
  )

const announceHumanSummary = (allowConsoleColors: boolean, summary: string) =>
  Boolean.match(allowConsoleColors, {
    onTrue: () => Console.log(ansi.green(summary)),
    onFalse: () => Console.log(summary),
  })

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
        StageError.make({ stage: 'prepare', reason: `Failed to start the reporter worker "${name}"`, cause })
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
    selectReporterChoices(names, choicesByName),
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

const selectReporterChoices = (names: readonly string[], choicesByName: HashMap.HashMap<string, ReporterChoice>) =>
  Array.map(
    Array.reduce(
      names,
      Array.empty<readonly [string, ReporterChoice]>(),
      (chosen, name) =>
        Option.match(HashMap.get(choicesByName, name.toLowerCase()), {
          onNone: () => chosen,
          onSome: (choice) =>
            Option.match(Array.findFirst(chosen, ([key]) => key === name.toLowerCase()), {
              onNone: () => [...chosen, [name.toLowerCase(), choice] as const],
              onSome: () => chosen,
            }),
        }),
    ),
    ([, choice]) => choice,
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
    const options: StrykerOptions = {
      ...configured,
      reporters: resolvedReporters,
      allowConsoleColors: env.allowConsoleColors,
      clearTextReporter: {
        ...configured.clearTextReporter,
        allowColor: env.allowConsoleColors,
      },
    }
    const descriptors: readonly string[] = pluginUrlsFromOptions(options)
    const loaded = yield* loadPlugins(descriptors).pipe(
      Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: 'Failed to load plugins', cause })),
    )
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

    const builtinReporterFactories: Record<string, ReporterFactory> = {
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
            { name: descriptor.name, builtinFactory: Option.none<ReporterFactory>() },
          ] as const,
      ),
    ])
    return {
      mode: env.resolvedMode.mode,
      reporters: [...options.reporters],
      fileCount: MutableHashMap.size(command.project.files),
      availableReporters: [...HashMap.values(reporterChoicesByName)].map((choice) => choice.name),
      env,
      queue,
      options,
      loaded,
      project: command.project,
      ignorers,
      builtinReporterFactories,
      reporterChoicesByName,
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
        const mutateCount = MutableHashMap.size(raw.project.filesToMutate)
        yield* announceSummary(
          raw.env,
          `Found ${mutateCount} of ${MutableHashMap.size(raw.project.files)} file(s) to be mutated.`,
        )
        yield* validateReporterNames(
          raw.options.reporters,
          [...HashMap.values(raw.reporterChoicesByName)].map((choice) => choice.name),
        ).pipe(
          Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: cause.message, cause })),
        )
        const failOnEmptyProject = (fileCount: number): Effect.Effect<void, StageError> =>
          Match.value(fileCount).pipe(
            Match.when(0, () =>
              Effect.fail(
                StageError.make({
                  stage: 'prepare',
                  reason: 'No input files found.',
                  cause: PrepareError.make({ stage: 'prepare', reason: 'No input files found.' }),
                }),
              )),
            Match.orElse(() => Effect.void),
          )

        yield* failOnEmptyProject(raw.project.files.pipe(MutableHashMap.size))
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
        const now = yield* Clock.currentTimeMillis
        yield* Queue.offer(raw.queue, PhaseEntered.make({ phase: 'prepare', elapsedMs: now - raw.env.runStartedAt }))
        return {
          project: raw.project,
          loadedPlugins: raw.loaded,
          ignorers: raw.ignorers,
          options: raw.options,
          temporaryDirectoryPath,
          reporterStage,
        }
      }),
  )

const STREAM_REPORTER = 'progress-stream'
const HUMAN_REPORTER = 'clear-text'

const STDOUT_REPORTERS: Readonly<Record<string, true>> = { 'clear-text': true, 'progress': true }

const asHumanReporter = (name: string): string => {
  if (name === STREAM_REPORTER) {
    return HUMAN_REPORTER
  }
  return name
}

const selectReporters: {
  (configured: readonly string[], mode: 'human' | 'machine'): readonly string[]
  (mode: 'human' | 'machine'): (configured: readonly string[]) => readonly string[]
} = dual(2, (configured: readonly string[], mode: 'human' | 'machine'): readonly string[] =>
  Match.value(mode).pipe(
    Match.when('human', () => [...new Set(configured.map(asHumanReporter))]),
    Match.when('machine', () => {
      const permitted = configured.filter((name) => STDOUT_REPORTERS[name] !== true)
      return Match.value(permitted.includes(STREAM_REPORTER)).pipe(
        Match.when(true, () => permitted),
        Match.when(false, () => [...permitted, STREAM_REPORTER]),
        Match.exhaustive,
      )
    }),
    Match.exhaustive,
  ))

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
