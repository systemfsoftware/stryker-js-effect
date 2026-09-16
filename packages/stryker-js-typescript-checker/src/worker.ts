import { CheckerRpcs, startRpcWorker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Layer from 'effect/Layer'

import { checkerHandlers } from './worker-handlers.js'

await startRpcWorker({
  rpcs: CheckerRpcs,
  handlers: checkerHandlers,
  schemaServices: Layer.empty,
  label: 'checker worker',
})
