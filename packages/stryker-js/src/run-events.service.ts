import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import type * as Queue from 'effect/Queue'

import type { RunEvent } from './run-event.schema.js'

export class RunEvents extends Context.Service<RunEvents, Queue.Queue<RunEvent, Cause.Done>>()(
  '@systemfsoftware/stryker-js/run-events.service/RunEvents',
) {}

export interface RunIdentityShape {
  readonly runId: string
  readonly basePath: string
}

export class RunIdentity extends Context.Service<RunIdentity, RunIdentityShape>()(
  '@systemfsoftware/stryker-js/run-events.service/RunIdentity',
) {}

export {
  FormatClaimShadowingRow,
  FormatRegistryResolved,
  FormatRegistryRow,
  FrameworkContributionRow,
  FrameworkModuleRow,
  Heartbeat,
  HelpRendered,
  ModeSignal,
  OutputMode,
  PhaseEntered,
  PlanKnown,
  PluginFailureReason,
  PluginsReported,
  RunEvent,
  RunFailed,
  RunMutantTested,
  RunPhase,
  RunStarted,
  type RunTerminalEvent,
  SkippedFileRow,
  SkippedReported,
  VerdictReached,
} from './run-event.schema.js'
