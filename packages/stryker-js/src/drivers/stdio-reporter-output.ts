import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { PlatformError } from 'effect/PlatformError'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import { type OutputChannel, ReporterOutput } from '../reporter-output.service.js'

type OutputSink = Sink.Sink<void, string | Uint8Array, never, PlatformError>

const sinkOf = (stdio: Stdio.Stdio, channel: OutputChannel): OutputSink =>
  Boolean.match(channel === 'stdout', {
    onTrue: () => stdio.stdout({ endOnDone: false }),
    onFalse: () => stdio.stderr({ endOnDone: false }),
  })

const writeChunks = (
  stdio: Stdio.Stdio,
  channel: OutputChannel,
  chunks: readonly string[],
): Effect.Effect<void, PlatformError> => Stream.run(Stream.fromIterable(chunks), sinkOf(stdio, channel))

export const layer: Layer.Layer<ReporterOutput, never, Stdio.Stdio> = Layer.effect(
  ReporterOutput,
  Effect.map(Stdio.Stdio, (stdio) =>
    ReporterOutput.of({
      write: (channel, chunks) => writeChunks(stdio, channel, chunks),
    })),
)
