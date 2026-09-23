import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'

import {
  type FailedRunOutcome,
  type RunOk,
  type RunOutcomeDecision,
  type RunOutcomeError,
} from './classify-run-outcome.workflow.js'
import { defaultOptions } from './config-defaults.js'
import { readCapturedConsole, shapeEnvelope } from './Envelope.js'
import type { ResolvedMode } from './output-mode.js'
import type { RunEventStream } from './run-event-stream.js'
import { HelpRendered, RunFailed, VerdictReached } from './RunEvent.schema.js'
import { STREAM_SCHEMA_VERSION } from './StreamVersion.js'
import { strykerVersion } from './stryker-package.js'
import { buildVerdictEnvelope } from './verdict-envelope.js'

export function emitNullScoreVerdict<Config = unknown>(
  stream: RunEventStream,
  mode: ResolvedMode,
  thresholds: schema.Thresholds,
  config: Readonly<Record<string, Config>>,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void, never, never> {
  const report: schema.MutationTestResult = {
    schemaVersion: '1.0',
    files: {},
    thresholds,
    projectRoot: basePath,
    config,
    framework: { name: 'StrykerJS', version: strykerVersion },
  }
  const envelope = buildVerdictEnvelope(
    report,
    mode.mode,
    mode.signal,
    stream.runId,
    basePath,
    pathService,
  )
  return Queue.offer(
    stream.queue,
    VerdictReached.make({
      schemaVersion: envelope.schemaVersion,
      runId: envelope.runId,
      mode: envelope.mode,
      signal: envelope.signal,
      score: envelope.score,
      thresholds: envelope.thresholds,
      reportFile: envelope.reportFile,
      counts: envelope.counts,
      mutants: envelope.mutants,
    }),
  )
}

function offerFailureEnvelope(
  stream: RunEventStream,
  failed: FailedRunOutcome,
  captured: string,
): Effect.Effect<void, never, never> {
  const envelope = shapeEnvelope(failed, captured)
  return Queue.offer(
    stream.queue,
    RunFailed.make({
      schemaVersion: envelope.schemaVersion,
      code: envelope.code,
      error: envelope.error,
      remediation: envelope.remediation,
    }),
  )
}

const emitHelpEnvelope = (
  stream: RunEventStream,
  help: string,
): Effect.Effect<void, never, never> =>
  Queue.offer(
    stream.queue,
    HelpRendered.make({
      schemaVersion: STREAM_SCHEMA_VERSION,
      code: 0,
      help,
    }),
  )

const helpPayload = (ok: RunOk, captured: string): Option.Option<string> =>
  Option.filter(Option.some(captured), () => ok.help || captured.length > 0)

const emitNullScoreVerdictWhenOpen = (
  stream: RunEventStream,
  mode: ResolvedMode,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const open = yield* stream.isOpen
    if (!open) {
      return
    }
    const defaults = yield* defaultOptions
    yield* emitNullScoreVerdict(
      stream,
      mode,
      defaults.thresholds,
      {},
      basePath,
      pathService,
    )
  })

export function emitMachineModeOutput(
  stream: RunEventStream,
  mode: ResolvedMode,
  outcome: Result.Result<RunOutcomeDecision, RunOutcomeError>,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void, never, never> {
  return Effect.gen(function*() {
    const captured = readCapturedConsole()
    if (Result.isSuccess(outcome)) {
      const decision = outcome.success
      return yield* Match.value(decision).pipe(
        Match.tag('RunOk', (ok): Effect.Effect<void, never, never> =>
          Option.match(helpPayload(ok, captured), {
            onSome: (help) => emitHelpEnvelope(stream, help),
            onNone: () =>
              emitNullScoreVerdictWhenOpen(
                stream,
                mode,
                basePath,
                pathService,
              ),
          })),
        Match.tag('RunParseFailed', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.tag('RunSurvivorsRejected', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.tag('RunConfigFailed', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.tag('RunFailed', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.exhaustive,
      )
    }
    return yield* offerFailureEnvelope(stream, outcome.failure, captured)
  })
}
