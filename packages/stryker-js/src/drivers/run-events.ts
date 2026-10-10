import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { RunEvents, WorkerReports } from '../run-events.service.js'

export const workerReportsLayer: Layer.Layer<WorkerReports, never, RunEvents> = Layer.effect(
  WorkerReports,
  Effect.gen(function*() {
    const queue = yield* RunEvents
    const counters: Record<RunEvent.WorkerRole, Ref.Ref<number>> = {
      testRunner: yield* Ref.make(0),
      checker: yield* Ref.make(0),
    }
    return WorkerReports.of({
      report: (role, startupMs) =>
        Effect.gen(function*() {
          const index = yield* Ref.getAndUpdate(counters[role], (current) => current + 1)
          yield* Queue.offer(
            queue,
            RunEvent.WorkerReported.make({
              schemaVersion: RunEvent.StreamSchemaVersion.literal,
              role,
              index,
              startupMs,
            }),
          )
        }),
    })
  }),
)
