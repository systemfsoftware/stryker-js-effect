/**
 * The stryker library program's composition root.
 *
 * The run stages keep their services in `R` everywhere else; this is the ONE
 * place a platform is bound — the Node worker launcher, filesystem, path, stdio
 * and V8 sandbox, plus the run-event drain — and the ONE place the published
 * program entry {@link strykerCell} runs a pipeline. `src/bin/main.ts` is the
 * CLI's own root: it binds the CLI's stdio, drains and telemetry, then reaches
 * the run through the host combinators exported here.
 */
import { NodeFileSystem, NodePath, NodeSocket, NodeStdio } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import * as NodeCrypto from '@effect/platform-node-shared/NodeCrypto'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Boolean from 'effect/Boolean'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'

import type { CliRequest } from '../Cli.schema.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { ProjectFiles } from '../project-files.service.js'
import { Reporter } from '../reporter.service.js'
import { ReporterOutput } from '../reporter-output.service.js'
import {
  RunEventDrain,
  RunEventDrainLive,
  makeRunEventStream,
  type RunEventStream,
} from '../run-event-stream.service.js'
import type { RunEvent } from '../run-event.schema.js'
import { RunEvents } from '../run-events.service.js'
import { RUN_EVENTS_QUEUE_BOUND } from '../Run.js'
import { StageError } from '../Run.schema.js'
import { type VmPlatform, VmRunner } from '../VmRunner.service.js'
import { classifyWorkerExit } from '../Worker.js'
import { layer as idGeneratorLayer } from '../Worker.service.js'
import { ChildProcessCrashedError } from '../Worker.schema.js'
import { type SpawnedSocketWorker, WorkerLauncher } from '../WorkerLauncher.service.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import { ProjectFiles } from '../project-files.service.js'
import { RunEnvironment, type RunEnvironmentShape } from './RunEnvironment.service.js'
import { mutationTestCell } from './run-stages.cell.js'
import type { EnginePorts, RunStageServices } from './StageServices.service.js'

export interface HostServices {
  readonly env: RunEnvironmentShape
  readonly events: Queue.Queue<RunEvent, Cause.Done>
}

export type StrykerRun = (
  options: PartialStrykerOptions,
  targetMutatePatterns?: string[],
) => Effect.Effect<MutationTestDone, StageError, never>

export const makeRunLayer: {
  (
    env: RunEnvironmentShape,
    events?: Queue.Queue<RunEvent, Cause.Done>,
  ): Layer.Layer<RunStageServices, never, EnginePorts>
  (
    events?: Queue.Queue<RunEvent, Cause.Done>,
  ): (env: RunEnvironmentShape) => Layer.Layer<RunStageServices, never, EnginePorts>
} = dual(
  (args) => Predicate.isObject(args[0]) && !Queue.isQueue(args[0]),
  (
    env: RunEnvironmentShape,
    events?: Queue.Queue<RunEvent, Cause.Done>,
  ): Layer.Layer<RunStageServices, never, EnginePorts> => {
    const eventsLayer: Layer.Layer<RunEvents> = Match.value(events).pipe(
      Match.when(undefined, () => Layer.effect(RunEvents, Queue.bounded<RunEvent, Cause.Done>(RUN_EVENTS_QUEUE_BOUND))),
      Match.orElse((queue) => Layer.succeed(RunEvents, queue)),
    )
    const stageLayer = Layer.mergeAll(
      Layer.succeed(RunEnvironment, env),
      eventsLayer,
      idGeneratorLayer,
      ProjectFiles.layer,
      Layer.effect(
        Scope.Scope,
        Effect.gen(function*() {
          const stageScope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(stageScope, Exit.void))
          return stageScope
        }),
      ),
    )
    return Layer.mergeAll(
      stageLayer,
      MutationReporting.layer.pipe(Layer.provide(stageLayer)),
      Reporter.layer.pipe(Layer.provide(ReporterOutput.layer)).pipe(Layer.provide(stageLayer)),
    )
  },
)

const restrictToOwnerOrWarn = (fs: FileSystem.FileSystem, file: string) =>
  fs.chmod(file, 0o600).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning(
        `Could not restrict "${file}" to its owner; the worker directory's own mode still protects it.`,
      ).pipe(Effect.annotateLogs('cause', cause))
    ),
    Effect.catchTag('PlatformError', () => Effect.void),
  )

const nodeWorkerLauncherLayer = Layer.effect(
  WorkerLauncher,
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    return {
      spawn: (params): Effect.Effect<SpawnedSocketWorker, ChildProcessCrashedError, Scope.Scope> =>
        Effect.gen(function*() {
          const workerDir = yield* fs.makeTempDirectoryScoped({ prefix: params.tempDirPrefix })
          const workerId = yield* crypto.randomUUIDv4
          const socketPath = Match.value(globalThis.process.platform).pipe(
            Match.when('win32', () => `\\\\.\\pipe\\stryker-worker-${workerId}`),
            Match.orElse(() => path.join(workerDir, 'worker.sock')),
          )
          const optionsFile = path.join(workerDir, 'options.json')
          yield* fs.writeFileString(optionsFile, params.optionsJson)
          yield* restrictToOwnerOrWarn(fs, optionsFile)

          const entrypointPath = yield* path.fromFileUrl(new URL(params.entrypoint))
          const handle = yield* ChildProcess.make(
            globalThis.process.execPath,
            [...params.execArgv, entrypointPath],
            {
              cwd: params.workingDirectory,
              extendEnv: true,
              env: { STRYKER_WORKER_DIR: workerDir, STRYKER_SOCKET: socketPath, ...params.env },
              stderr: 'inherit',
            },
          ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))

          const clientLayer = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
            Layer.provide(NodeSocket.layerNet({ path: socketPath })),
            Layer.provide(RpcSerialization.layerNdjson),
          )

          const exited = handle.exitCode.pipe(
            Effect.orDie,
            Effect.flatMap((exitCode) => Effect.fail(classifyWorkerExit(Number(handle.pid), exitCode))),
          )

          return { pid: Number(handle.pid), clientLayer, exited }
        }).pipe(
          Effect.catchIf(S.is(ChildProcessCrashedError), (error) => Effect.fail(error), () =>
            Effect.fail(
              ChildProcessCrashedError.make({
                pid: 0,
                exit: { _tag: 'Code', code: 1 },
                cause: 'worker spawn failed',
              }),
            )),
        ),
    }
  }),
)

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const nodeSpawnerLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(nodeFsPathLayer))

const nodeBase = Layer.mergeAll(nodeFsPathLayer, nodeSpawnerLayer, NodeStdio.layer)

const nodeVmPlatformLayer = Layer.effect(
  VmRunner,
  Effect.sync(
    (): VmPlatform => ({
      module: globalThis.process.getBuiltinModule('node:module'),
      vm: globalThis.process.getBuiltinModule('node:vm'),
    }),
  ),
)

const nodePlatformLayer = Layer.mergeAll(
  nodeWorkerLauncherLayer.pipe(Layer.provide(Layer.merge(nodeBase, NodeCrypto.layer))),
  nodeBase,
  nodeVmPlatformLayer,
)

const isColorEnabled = (mode: ResolvedMode, noColor: string | undefined) =>
  Boolean.match(mode.mode === 'human', {
    onTrue: () => Option.isNone(Option.filter(Option.fromUndefinedOr(noColor), S.is(S.NonEmptyString))),
    onFalse: () => false,
  })

const hostRunLayer = Layer
  .unwrap(
    Effect.map(
      Effect.all([RunEnvironment, RunEvents], { concurrency: 1 }),
      ([env, events]) => makeRunLayer(env, events),
    ),
  ).pipe(Layer.provideMerge(nodePlatformLayer))

const hostLayerOf = (host: HostServices) =>
  Layer.provideMerge(
    hostRunLayer,
    Layer.merge(Layer.succeed(RunEnvironment, host.env), Layer.succeed(RunEvents, host.events)),
  )

const hostMutationTest = (host: HostServices) =>
  Effect.map(Layer.build(hostLayerOf(host)), (context) => Cell.provideContext(mutationTestCell, context))

export const onHost = dual<
  <A, E>(
    effect: Effect.Effect<A, E, RunStageServices | EnginePorts | RunEnvironment | RunEvents>,
  ) => (host: HostServices) => Effect.Effect<A, E, never>,
  <A, E>(
    host: HostServices,
    effect: Effect.Effect<A, E, RunStageServices | EnginePorts | RunEnvironment | RunEvents>,
  ) => Effect.Effect<A, E, never>
>(
  2,
  <A, E>(
    host: HostServices,
    effect: Effect.Effect<A, E, RunStageServices | EnginePorts | RunEnvironment | RunEvents>,
  ): Effect.Effect<A, E, never> =>
    Layer.build(hostLayerOf(host)).pipe(
      Effect.flatMap((context) => Effect.provideContext(effect, context)),
      Effect.scoped,
    ),
)

export const runOnHost = dual<
  (command: PrepareExecutorArgs) => (host: HostServices) => Effect.Effect<MutationTestDone, StageError, never>,
  (host: HostServices, command: PrepareExecutorArgs) => Effect.Effect<MutationTestDone, StageError, never>
>(
  2,
  (host, command) =>
    onHost(host, Effect.scoped(Effect.flatMap(hostMutationTest(host), (cell) => cell.run(command)))),
)

export const prepareCommandOf = dual<
  (
    targetMutatePatterns: string[] | undefined,
  ) => (options: PartialStrykerOptions) => PrepareExecutorArgs,
  (options: PartialStrykerOptions, targetMutatePatterns: string[] | undefined) => PrepareExecutorArgs
>(2, (options, targetMutatePatterns) => ({ cliOptions: options, targetMutatePatterns }))

const targetMutatePatternsOf = (patterns: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(patterns), {
    onNone: () => undefined,
    onSome: (present) => [...present],
  })

export const hostOptionsOf = dual<
  (
    stream: RunEventStream,
    noColor: string | undefined,
  ) => (mode: ResolvedMode) => Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>,
  (
    mode: ResolvedMode,
    stream: RunEventStream,
    noColor: string | undefined,
  ) => Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
>(3, (mode, stream, noColor) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return {
      runId: stream.runId,
      resolvedMode: mode,
      runStartedAt: stream.startedAt,
      basePath: yield* fs.realPath('.'),
      builtinReporters: { html: makeHtmlReporter },
      allowConsoleColors: isColorEnabled(mode, noColor),
    }
  }))

export const progressStreamFileName = (request: Option.Option<CliRequest>): string =>
  Option.match(request, {
    onNone: () => RunEventDrain.DefaultProgressStreamFile,
    onSome: (cliRequest) =>
      Match.value(cliRequest).pipe(
        Match.tag('merge-reports', () => RunEventDrain.DefaultProgressStreamFile),
        Match.tag('run', (runRequest) =>
          Option.getOrElse(
            S.decodeUnknownOption(S.NonEmptyString)(runRequest.options['progressStreamFile']),
            () => RunEventDrain.DefaultProgressStreamFile,
          )),
        Match.exhaustive,
      ),
  })

export const applyProgressStreamFile = (fileName: string) =>
  Effect.gen(function*() {
    const drain = yield* RunEventDrain
    yield* drain.setProgressStreamFile(fileName)
  })

const HEADLESS_MODE: ResolvedMode = { mode: 'machine', signal: 'flag', stdoutIsTTY: false }

const headlessHost = Effect.gen(function*() {
  const stream = yield* makeRunEventStream(HEADLESS_MODE)
  const env = yield* hostOptionsOf(HEADLESS_MODE, stream, undefined)
  return { env, events: stream.queue }
})

const strykerRunLayer = Layer
  .unwrap(Effect.map(headlessHost, hostLayerOf))
  .pipe(Layer.provide(RunEventDrainLive), Layer.provideMerge(nodePlatformLayer))

export const strykerCell: {
  (
    options: PartialStrykerOptions,
    targetMutatePatterns?: readonly string[],
  ): Effect.Effect<
    MutationTestDone,
    StageError | PlatformError,
    FileSystem.FileSystem | Path.Path | Stdio.Stdio
  >
  (
    targetMutatePatterns?: readonly string[],
  ): (
    options: PartialStrykerOptions,
  ) => Effect.Effect<
    MutationTestDone,
    StageError | PlatformError,
    FileSystem.FileSystem | Path.Path | Stdio.Stdio
  >
} = dual(
  (args) => Predicate.isObject(args[0]),
  (options: PartialStrykerOptions, targetMutatePatterns?: readonly string[]) =>
    Effect.gen(function*() {
      const context = yield* Layer.build(strykerRunLayer)
      return yield* Cell.provideContext(mutationTestCell, context).run(
        prepareCommandOf(options, targetMutatePatternsOf(targetMutatePatterns)),
      )
    }).pipe(Effect.scoped),
)
