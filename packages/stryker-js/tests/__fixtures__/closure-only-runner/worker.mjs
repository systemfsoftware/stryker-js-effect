import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import { join } from 'node:path'

const TEST_FILE = 'test/math.test.js'
const TEST_ID = `${TEST_FILE}#adds a doubled number`

const handlers = Plugin.TestRunnerRpcs.toLayer({
  capabilities: () => Effect.succeed({ reloadEnvironment: true }),
  dryRun: () =>
    Effect.succeed({
      status: 'complete',
      tests: [{
        id: TEST_ID,
        name: 'adds a doubled number',
        timeSpentMs: 1,
        status: 'success',
        fileName: join(process.cwd(), TEST_FILE),
      }],
    }),
  mutantRun: () =>
    Stream.make(
      TestRunner.MutantRunStarted.make({}),
      TestRunner.MutantRunSettled.make({
        result: {
          status: 'killed',
          killedBy: [TEST_ID],
          failureMessage: 'expected 5',
          nrOfTests: 1,
          executedTests: [{ id: TEST_ID, timeSpentMs: 1 }],
        },
      }),
    ),
})

NodeRuntime.runMain(
  Layer.launch(
    Worker.workerServerLayer({ rpcs: Plugin.TestRunnerRpcs, handlers, schemaServices: Layer.empty }).pipe(
      Layer.provide(NodeSocketServer.layer({ path: process.env['STRYKER_SOCKET'] })),
      Layer.provide(NodeFileSystem.layer),
    ),
  ),
)
