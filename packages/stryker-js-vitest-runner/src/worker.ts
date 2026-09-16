import { startRpcWorker, TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Layer from 'effect/Layer'

import { testRunnerHandlers } from './worker-handlers.js'

await startRpcWorker({
  rpcs: TestRunnerRpcs,
  handlers: testRunnerHandlers,
  schemaServices: Layer.empty,
  label: 'test runner worker',
})
