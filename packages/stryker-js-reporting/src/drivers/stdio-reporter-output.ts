import { Reports } from '@systemfsoftware/stryker-js-contracts'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { PlatformError } from 'effect/PlatformError'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

type OutputSink = Sink.Sink<void, string | Uint8Array, never, PlatformError>

const sinkOf = (stdio: Stdio.Stdio, channel: Reports.OutputChannel): OutputSink =>
  Boolean.match(channel === 'stdout', {
    onTrue: () => stdio.stdout({ endOnDone: false }),
    onFalse: () => stdio.stderr({ endOnDone: false }),
  })

const writeChunks = (
  stdio: Stdio.Stdio,
  channel: Reports.OutputChannel,
  chunks: readonly string[],
): Effect.Effect<void, PlatformError> => Stream.run(Stream.fromIterable(chunks), sinkOf(stdio, channel))

export const layer: Layer.Layer<Reports.ReporterOutput, never, Stdio.Stdio> = Layer.effect(
  Reports.ReporterOutput,
  Effect.map(Stdio.Stdio, (stdio) =>
    Reports.ReporterOutput.of({
      write: (channel, chunks) => writeChunks(stdio, channel, chunks),
    })),
)
