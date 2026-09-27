import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import type * as Queue from 'effect/Queue'

import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'

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
