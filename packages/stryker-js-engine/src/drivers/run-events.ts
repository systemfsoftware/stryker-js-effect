import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Run } from '@systemfsoftware/stryker-js-contracts'

export const workerReportsLayer: Layer.Layer<Run.WorkerReports, never, Run.RunEvents> = Layer.effect(
  Run.WorkerReports,
  Effect.gen(function*() {
    const queue = yield* Run.RunEvents
    const counters: Record<RunEvent.WorkerRole, Ref.Ref<number>> = {
      testRunner: yield* Ref.make(0),
      checker: yield* Ref.make(0),
    }
    return Run.WorkerReports.of({
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
