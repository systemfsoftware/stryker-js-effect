import { NodeFileSystem, NodePath, NodeSocket, NodeStdio } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import * as NodeCrypto from '@effect/platform-node-shared/NodeCrypto'
import { Cell } from '@systemfsoftware/effect-cell-types'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'

import type { ResolvedMode } from '../output-mode.schema.js'
import { readProjectCell } from '../read-project.cell.js'
import { RunEventDrainLive, makeRunEventStream } from '../run-event-stream.service.js'
import { StageError } from '../Run.schema.js'
import { type VmPlatform, VmRunner } from '../VmRunner.service.js'
import { ChildProcessCrashedError } from '../Worker.schema.js'
import { type SpawnedSocketWorker, WorkerLauncher } from '../WorkerLauncher.service.js'
import { dryRunCell } from './dry-run.cell.js'
import { hostLayerOf, hostOptionsOf, prepareCommandOf } from './host.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { mutationTestCell as mutationTestStageCell } from './mutation-test.cell.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import type { StageServices } from './StageServices.service.js'

const prepareStageCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.mapError(loadConfigCell, (cause) =>
        StageError.make({ stage: 'prepare', reason: 'Failed to read config', cause })),
      Cell.mapError(readProjectCell, (cause) =>
        StageError.make({ stage: 'prepare', reason: 'Failed to read project', cause })),
    ),
    prepareCell,
  ),
  Cell.andThen(Cell.andThen(instrumentCell, dryRunCell), mutationTestStageCell),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, StageError, StageServices> =
  prepareStageCell


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

const HEADLESS_MODE: ResolvedMode = { mode: 'machine', signal: 'flag', stdoutIsTTY: false }

const headlessHost = Effect.gen(function*() {
  const stream = yield* makeRunEventStream(HEADLESS_MODE)
  const env = yield* hostOptionsOf(HEADLESS_MODE, stream, undefined)
  return { env, events: stream.queue }
})

const strykerRunLayer = Layer
  .unwrap(Effect.map(headlessHost, (host) => hostLayerOf(host)))
  .pipe(Layer.provide(RunEventDrainLive), Layer.provideMerge(nodePlatformLayer))

const targetMutatePatternsOf = (patterns: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(patterns), {
    onNone: () => undefined,
    onSome: (present) => [...present],
  })

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
