import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { TestRunnerRpcs, workerServerLayer } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'

import { testRunnerHandlers } from './worker-handlers.js'

NodeRuntime.runMain(
  Layer.launch(
    workerServerLayer({
      rpcs: TestRunnerRpcs,
      handlers: testRunnerHandlers,
      schemaServices: Layer.empty,
    }),
  ).pipe(Effect.provideService(Logger.LogToStderr, true)),
)
