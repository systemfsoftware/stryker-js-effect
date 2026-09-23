import { NodeFileSystem, NodePath, NodeSocket, NodeStdio } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import * as NodeCrypto from '@effect/platform-node-shared/NodeCrypto'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import type { EnginePorts } from '../run/StageServices.js'
import { type VmPlatform, VmRunner } from '../VmRunner.js'
import { classifyWorkerExit } from '../Worker.js'
import { ChildProcessCrashedError } from '../Worker.schema.js'
import { type SpawnedSocketWorker, WorkerLauncher } from '../WorkerLauncher.js'

const restrictToOwnerOrWarn = (fs: FileSystem.FileSystem, file: string): Effect.Effect<void> =>
  fs.chmod(file, 0o600).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning(
        `Could not restrict "${file}" to its owner; the worker directory's own mode still protects it.`,
      ).pipe(Effect.annotateLogs('cause', cause))
    ),
    Effect.catchTag('PlatformError', () => Effect.void),
  )

/**
 * The Node worker launcher: spawn a worker child with this runtime's
 * executable, host the RPC server's address as a `net` `path` endpoint (a
 * socket file in the worker directory on POSIX, a same-user named pipe on
 * Windows), and connect the NDJSON protocol client over `NodeSocket`.
 */
export const nodeWorkerLauncherLayer: Layer.Layer<
  WorkerLauncher,
  never,
  Crypto.Crypto | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
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
          Effect.catchIf(Schema.is(ChildProcessCrashedError), (error) => Effect.fail(error), () =>
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

export const nodeFsPathLayer: Layer.Layer<FileSystem.FileSystem | Path.Path> = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
)

const nodeSpawnerLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(nodeFsPathLayer))

const nodeBase = Layer.mergeAll(nodeFsPathLayer, nodeSpawnerLayer, NodeStdio.layer)

export const nodePlatformLayer: Layer.Layer<EnginePorts> = Layer.mergeAll(
  nodeWorkerLauncherLayer.pipe(Layer.provide(Layer.merge(nodeBase, NodeCrypto.layer))),
  nodeBase,
)

/**
 * The in-memory runner's platform: the V8 sandbox module and the module
 * builtin that strips TypeScript and resolves a sandbox's `require`.
 *
 * Reached through `globalThis.process.getBuiltinModule` rather than an `import` because a
 * Node builtin import is forbidden in product code; the call is wrapped in
 * `Effect.promise` so a platform without `node:vm` fails as a defect — the
 * runner has no fallback to fall back to.
 */
export const nodeVmPlatformLayer: Layer.Layer<VmRunner> = Layer.effect(
  VmRunner,
  Effect.sync(
    (): VmPlatform => ({
      moduleBuiltin: globalThis.process.getBuiltinModule('node:module'),
      pathToFileURL: (path) => globalThis.process.getBuiltinModule('node:url').pathToFileURL(path),
    }),
  ),
)
