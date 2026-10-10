import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Path from 'effect/Path'
import type * as Queue from 'effect/Queue'
import type * as Result from 'effect/Result'
import type * as Stdio from 'effect/Stdio'
import type * as Stream from 'effect/Stream'

import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { RunOutcomeDecision, RunOutcomeError } from './classify-run-outcome.workflow.js'
import type { ResolvedMode, ResolvedModeInput } from './output-mode.schema.js'
import type { MachineConsole } from './reporting/machine-console.service.js'

export type FramedDrain = (
  framed: Stream.Stream<string, never, never>,
  toStdout: boolean,
) => Effect.Effect<void, never, never>

const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export interface RunEventDrainShape {
  readonly drainFramed: FramedDrain
  readonly setProgressStreamFile: (fileName: string) => Effect.Effect<void, never, never>
}

export class RunEventDrain extends Context.Service<RunEventDrain, RunEventDrainShape>()(
  '@systemfsoftware/stryker-js/run-event-stream.service/RunEventDrain',
) {
  static readonly DefaultProgressStreamFile = DEFAULT_PROGRESS_STREAM_FILE
}

export interface RunEventStream {
  readonly queue: Queue.Queue<RunEvent.RunEvent, Cause.Done>
  readonly runId: RunEvent.RunId
  readonly startedAt: number
  readonly isOpen: Effect.Effect<boolean, never, never>
  readonly ensureOpen: (openResolved: ResolvedModeInput) => Effect.Effect<void, never, never>
  readonly open: Effect.Effect<void, never, never>
  readonly closeAndDrain: Effect.Effect<void, never, never>
}

export interface EmitNullScoreVerdictOptions<Config = unknown> {
  readonly stream: RunEventStream
  readonly mode: ResolvedMode
  readonly thresholds: RunEvent.VerdictThresholds
  readonly config: Readonly<Record<string, Config>>
  readonly basePath: string
  readonly pathService: Path.Path
}

export interface EmitMachineModeOutputOptions {
  readonly stream: RunEventStream
  readonly mode: ResolvedMode
  readonly outcome: Result.Result<RunOutcomeDecision, RunOutcomeError>
  readonly basePath: string
  readonly pathService: Path.Path
}

export interface RunEventStreamPort {
  readonly createRunEventStream: (
    resolved: ResolvedModeInput,
  ) => Effect.Effect<RunEventStream, never, Stdio.Stdio | RunEventDrain>
  readonly emitNullScoreVerdict: <Config = unknown>(
    params: EmitNullScoreVerdictOptions<Config>,
  ) => Effect.Effect<void>
  readonly emitMachineModeOutput: (params: EmitMachineModeOutputOptions) => Effect.Effect<void, never, MachineConsole>
}

export class RunEventStreamPortTag extends Context.Service<RunEventStreamPortTag, RunEventStreamPort>()(
  '@systemfsoftware/stryker-js/run-event-stream.service/RunEventStreamPortTag',
) {}

export const RunEventStreamPort = RunEventStreamPortTag
