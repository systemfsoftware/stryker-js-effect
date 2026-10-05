import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'

export class RunEvents extends Context.Service<RunEvents, Queue.Queue<RunEvent.RunEvent, Cause.Done>>()(
  '@systemfsoftware/stryker-js/run-events.service/RunEvents',
) {}

export interface RunIdentityShape {
  readonly runId: string
  readonly basePath: string
}

export class RunIdentity extends Context.Service<RunIdentity, RunIdentityShape>()(
  '@systemfsoftware/stryker-js/run-events.service/RunIdentity',
) {}

export interface WorkerReportsShape {
  readonly report: (role: RunEvent.WorkerRole, startupMs: number) => Effect.Effect<void>
}

export class WorkerReports extends Context.Service<WorkerReports, WorkerReportsShape>()(
  '@systemfsoftware/stryker-js/run-events.service/WorkerReports',
) {}

export const WorkerReportsLive: Layer.Layer<WorkerReports, never, RunEvents> = Layer.effect(
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
