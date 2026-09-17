import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import type * as Queue from 'effect/Queue'

import type { RunEvent } from './Run.schema.js'

export class RunEvents extends Context.Service<RunEvents, Queue.Queue<RunEvent, Cause.Done>>()(
  '~@systemfsoftware/stryker-js-language/RunEvents',
) {}

export interface RunIdentityShape {
  readonly runId: string
  readonly basePath: string
}

export class RunIdentity extends Context.Service<RunIdentity, RunIdentityShape>()(
  '~@systemfsoftware/stryker-js-language/RunIdentity',
) {}

export {
  Heartbeat,
  HelpRendered,
  ModeSignal,
  OutputMode,
  PhaseEntered,
  PlanKnown,
  type RunEvent,
  RunFailed,
  RunMutantTested,
  RunPhase,
  RunStarted,
  type RunTerminalEvent,
  VerdictReached,
} from './Run.schema.js'

export type { RunEvent as RunEventType } from './Run.schema.js'
