import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { CheckerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { workerServerLayer } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'

import { checkerHandlers } from './worker-handlers.js'

NodeRuntime.runMain(
  Layer.launch(
    workerServerLayer({
      rpcs: CheckerRpcs,
      handlers: checkerHandlers,
      schemaServices: Layer.empty,
    }),
  ).pipe(Effect.provideService(Logger.LogToStderr, true)),
)
