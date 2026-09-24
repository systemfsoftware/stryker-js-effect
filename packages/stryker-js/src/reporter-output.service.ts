import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { PlatformError } from 'effect/PlatformError'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

export type OutputChannel = 'stdout' | 'stderr'

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

export interface ReporterOutputShape {
  readonly write: (channel: OutputChannel, chunks: readonly string[]) => Effect.Effect<void, PlatformError>
}

export class ReporterOutput extends Context.Service<ReporterOutput, ReporterOutputShape>()(
  '@systemfsoftware/stryker-js/reporter-output.service/ReporterOutput',
) {
  static readonly layer: Layer.Layer<ReporterOutput, never, Stdio.Stdio> = Layer.effect(
    ReporterOutput,
    Effect.map(Stdio.Stdio, (stdio) =>
      ReporterOutput.of({
        write: (channel, chunks) => writeChunks(stdio, channel, chunks),
      })),
  )
}
