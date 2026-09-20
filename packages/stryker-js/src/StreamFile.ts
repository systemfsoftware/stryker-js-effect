import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'
import { RunEventStreamLive } from './run-event-stream.js'
import { RunEventDrain, type RunEventStreamPortTag } from './run-event-stream.js'

export const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

const encodeUtf8 = (line: string): Uint8Array => new TextEncoder().encode(line)

const drainStdoutAndFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  stdio: Stdio.Stdio,
  fileName: string,
  framed: Stream.Stream<string>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
    yield* Effect.scoped(
      Effect.gen(function*() {
        const handle = yield* fs.open(fileName, { flag: 'w' })
        const withFile = framed.pipe(
          Stream.tap((line) =>
            handle.writeAll(encodeUtf8(line)).pipe(
              Effect.flatMap(() => handle.sync),
            )
          ),
        )
        yield* Stream.run(withFile, stdio.stdout({ endOnDone: true })).pipe(
          Effect.ignore,
        )
      }),
    )
  }).pipe(Effect.orDie)

export const RunEventDrainFileLive: Layer.Layer<
  RunEventDrain,
  never,
  Stdio.Stdio | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  RunEventDrain,
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fileNameRef = yield* Ref.make(DEFAULT_PROGRESS_STREAM_FILE)
    return RunEventDrain.of({
      drainFramed: (framed: Stream.Stream<string, never, never>) =>
        Effect.gen(function*() {
          const fileName = yield* Ref.get(fileNameRef)
          yield* drainStdoutAndFile(fs, path, stdio, fileName, framed)
        }).pipe(
          Effect.catchCause((cause) => Effect.logError('stryker.output.drain_file_failed', cause)),
        ),
      setProgressStreamFile: (fileName: string) => Ref.set(fileNameRef, fileName),
    })
  }),
)

export const RunEventStreamFileLive: Layer.Layer<
  RunEventStreamPortTag,
  never,
  Stdio.Stdio | FileSystem.FileSystem | Path.Path
> = RunEventStreamLive.pipe(Layer.provide(RunEventDrainFileLive))
