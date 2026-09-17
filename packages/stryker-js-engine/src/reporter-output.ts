import * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

export type OutputChannel = 'stdout' | 'stderr'

type OutputSink = Sink.Sink<void, string | Uint8Array, never, PlatformError>

const sinksOf = (stdio: Stdio.Stdio): Record<OutputChannel, () => OutputSink> => ({
  stdout: () => stdio.stdout({ endOnDone: false }),
  stderr: () => stdio.stderr({ endOnDone: false }),
})

const sinkFor = (stdio: Stdio.Stdio, channel: OutputChannel): OutputSink => sinksOf(stdio)[channel]()

export const write = (
  stdio: Stdio.Stdio,
  channel: OutputChannel,
  chunks: readonly string[],
): Effect.Effect<void, PlatformError> => Stream.run(Stream.fromIterable(chunks), sinkFor(stdio, channel))

/**
 * The one Effect→Promise bridge for the sync-loop progress bar (the only reporter
 * that cannot compose Effects — its writes fire inside a synchronous for-await).
 * Write errors are ignored like a broken pipe on a stream handle.
 *
 * Note: effect 4.0.0-rc.112 exports the runner as `Effect.runPromise`; there is no
 * `Runtime.runPromise` in this version (verified against the installed source) —
 * do not invent that import.
 */
export const writeAsync = (stdio: Stdio.Stdio, channel: OutputChannel, chunks: readonly string[]): Promise<void> =>
  Effect.runPromise(Effect.ignore(write(stdio, channel, chunks)))
