import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const refusal = Reporter.ReporterFailed.make({
  reporterName: 'refusing',
  event: 'mutationTestReportReady',
  cause: 'the reporter refuses the finished report',
})

const refuseTheFinishedReport = (batch) =>
  batch.some((event) => event._tag === 'mutationTestReportReady') ? Effect.fail(refusal) : Effect.void

const handlers = Plugin.ReporterRpcs.toLayer({
  init: () => Effect.void,
  onEventBatch: refuseTheFinishedReport,
  flush: () => Effect.void,
})

NodeRuntime.runMain(
  Layer.launch(
    Worker.workerServerLayer({ rpcs: Plugin.ReporterRpcs, handlers, schemaServices: Layer.empty }).pipe(
      Layer.provide(NodeSocketServer.layer({ path: process.env['STRYKER_SOCKET'] })),
      Layer.provide(NodeFileSystem.layer),
    ),
  ),
)
