import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'

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
