import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const blockTheMainThreadForever = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)

const recordPid = async () => {
  const options = JSON.parse(await readFile(join(process.env['STRYKER_WORKER_DIR'], 'options.json'), 'utf8'))
  await writeFile(options.testRunner.options.pidFile, String(process.pid))
}

const recordPidThenFreeze = Effect.promise(recordPid).pipe(
  Effect.andThen(Effect.sync(blockTheMainThreadForever)),
  Effect.andThen(Effect.never),
)

const handlers = Plugin.TestRunnerRpcs.toLayer({
  capabilities: () => Effect.succeed({ reloadEnvironment: true }),
  dryRun: () => recordPidThenFreeze,
  mutantRun: () => recordPidThenFreeze,
})

NodeRuntime.runMain(
  Layer.launch(
    Worker.workerServerLayer({ rpcs: Plugin.TestRunnerRpcs, handlers, schemaServices: Layer.empty }).pipe(
      Layer.provide(NodeSocketServer.layer({ path: process.env['STRYKER_SOCKET'] })),
      Layer.provide(NodeFileSystem.layer),
    ),
  ),
)
