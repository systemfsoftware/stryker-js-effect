import { NodeFileSystem, NodePath, NodeSocket, NodeStdio } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import * as NodeCrypto from '@effect/platform-node-shared/NodeCrypto'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Crypto from 'effect/Crypto'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyEmptyDirectoryRemoval,
  ClassifyEmptyDirectoryRemovalCommand,
} from './classify-empty-directory-removal.workflow.js'
import { classifyWorkerExit, ClassifyWorkerExitCommand } from './classify-worker-exit.workflow.js'
import { EmptyDirectoryRemovalRejected } from './empty-directory.schema.js'
import { EmptyDirectory } from './empty-directory.service.js'
import { GitDiff } from './git-diff.service.js'
import { layer as oxcSourceParserLayer } from './oxc-source-parser.js'
import type { EnginePorts } from './run/StageServices.service.js'
import { make as makeSpawnedSocketWorker } from './spawned-socket-worker.handle.js'
import { layerWorkerProtocol } from './worker-protocol.blueprint.js'
import { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'
import { WorkerLauncher, type WorkerSpawnParams } from './WorkerLauncher.service.js'

const WORKER_TERMINATION_GRACE = Duration.seconds(5)

const restrictToOwnerOrWarn = (fs: FileSystem.FileSystem, file: string) =>
  fs.chmod(file, 0o600).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning(
        `Could not restrict "${file}" to its owner; the worker directory's own mode still protects it.`,
      ).pipe(Effect.annotateLogs('cause', cause))
    ),
    Effect.catchTag('PlatformError', () => Effect.void),
  )

const nodeWorkerLauncherLayer = (childEnv: Readonly<Record<string, string>>) =>
  Layer.effect(
    WorkerLauncher,
    Effect.gen(function*() {
      const crypto = yield* Crypto.Crypto
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      return {
        spawn: Effect.fn(SpanTaxonomy.Spans.workerSpawn.name)(
          function*(params: WorkerSpawnParams) {
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
                env: { STRYKER_WORKER_DIR: workerDir, STRYKER_SOCKET: socketPath, ...childEnv, ...params.env },
                stderr: 'inherit',
                forceKillAfter: WORKER_TERMINATION_GRACE,
              },
            ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))

            const clientLayer = layerWorkerProtocol(NodeSocket.layerNet({ path: socketPath }))

            const exited = handle.exitCode.pipe(
              Effect.orDie,
              Effect.flatMap((exitCode) =>
                Result.match(
                  classifyWorkerExit(ClassifyWorkerExitCommand.make({ pid: Number(handle.pid), exitCode })),
                  {
                    onFailure: (refused) => Effect.fail(refused),
                    onSuccess: (decision) =>
                      Match.value(decision).pipe(
                        Match.tag(
                          'WorkerOutOfMemory',
                          (outOfMemory) =>
                            Effect.fail(
                              OutOfMemoryError.make({ pid: outOfMemory.pid, exitCode: outOfMemory.exitCode }),
                            ),
                        ),
                        Match.tag(
                          'WorkerCrashed',
                          (crashed) =>
                            Effect.fail(
                              ChildProcessCrashedError.make({
                                pid: crashed.pid,
                                exit: { _tag: 'Code', code: crashed.exitCode },
                                cause: 'worker exited before it accepted the RPC connection',
                              }),
                            ),
                        ),
                        Match.exhaustive,
                      ),
                  },
                )
              ),
            )

            return makeSpawnedSocketWorker({ pid: Number(handle.pid), clientLayer, exited })
          },
          (spawned) =>
            spawned.pipe(
              Effect.catchIf(S.is(ChildProcessCrashedError), (error) => Effect.fail(error), () =>
                Effect.fail(
                  ChildProcessCrashedError.make({
                    pid: 0,
                    exit: { _tag: 'Code', code: 1 },
                    cause: 'worker spawn failed',
                  }),
                )),
            ),
        ),
      }
    }),
  )

const hasErrnoCode = (cause: unknown): cause is { readonly code: string } =>
  Predicate.hasProperty(cause, 'code') && Predicate.isString(cause.code)

const removalErrorTagByCode: Readonly<Record<string, PlatformError.SystemErrorTag>> = {
  EACCES: 'PermissionDenied',
  EPERM: 'PermissionDenied',
  EISDIR: 'BadResource',
  EBUSY: 'Busy',
  ELOOP: 'BadResource',
}

const removalErrorTag = (code: string | undefined): PlatformError.SystemErrorTag =>
  Option.getOrElse(
    Option.fromNullishOr(code).pipe(Option.flatMap((defined) => Option.fromNullishOr(removalErrorTagByCode[defined]))),
    (): PlatformError.SystemErrorTag => 'Unknown',
  )

const settleRemoval = (
  rejection: EmptyDirectoryRemovalRejected,
  path: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Result.match(
    classifyEmptyDirectoryRemoval(ClassifyEmptyDirectoryRemovalCommand.make({ code: rejection.code })),
    {
      onFailure: (impossible) => Effect.fail(impossible),
      onSuccess: (removal) =>
        Match.value(removal).pipe(
          Match.tag('DirectoryKept', () => Effect.void),
          Match.tag('DirectoryAbsent', () => Effect.void),
          Match.tag('RemovalFailed', (failed) =>
            Effect.fail(
              PlatformError.systemError({
                _tag: removalErrorTag(failed.code),
                module: 'EmptyDirectory',
                method: 'removeIfEmpty',
                syscall: 'rmdir',
                pathOrDescriptor: path,
                description: failed.code,
                cause: rejection.cause,
              }),
            )),
          Match.exhaustive,
        ),
    },
  )

const nodeEmptyDirectoryLayer = Layer.succeed(
  EmptyDirectory,
  EmptyDirectory.of({
    removeIfEmpty: (path) =>
      Effect.tryPromise({
        try: () => globalThis.process.getBuiltinModule('node:fs/promises').rmdir(path),
        catch: (cause) =>
          EmptyDirectoryRemovalRejected.make({
            code: hasErrnoCode(cause) ? cause.code : undefined,
            cause,
          }),
      }).pipe(Effect.catch((rejection) => settleRemoval(rejection, path))),
  }),
)

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const nodeSpawnerLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(nodeFsPathLayer))

const nodeBase = Layer.mergeAll(nodeFsPathLayer, nodeSpawnerLayer, NodeStdio.layer)

export const makeNodePlatformLayer = (options: {
  readonly childEnv: Readonly<Record<string, string>>
}): Layer.Layer<EnginePorts> =>
  Layer.mergeAll(
    nodeWorkerLauncherLayer(options.childEnv).pipe(Layer.provide(Layer.merge(nodeBase, NodeCrypto.layer))),
    nodeBase,
    GitDiff.layer.pipe(Layer.provide(Layer.merge(nodeSpawnerLayer, nodeFsPathLayer))),
    oxcSourceParserLayer,
    nodeEmptyDirectoryLayer,
  )

export const nodePlatformLayer: Layer.Layer<EnginePorts> = makeNodePlatformLayer({ childEnv: {} })
