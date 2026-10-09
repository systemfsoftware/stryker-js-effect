import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import {
  emitMachineModeOutput,
  emitNullScoreVerdict,
  makeRunEventStream,
  RunEventDrain,
  RunEventStreamPortTag,
} from '../run-event-stream.service.js'

export const drainLayer: Layer.Layer<RunEventDrain, never, Stdio.Stdio> = Layer.effect(
  RunEventDrain,
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    return RunEventDrain.of({
      drainFramed: (framed, toStdout) => drainOf(stdio, framed, toStdout),
      setProgressStreamFile: () => Effect.void,
    })
  }),
)

export const fileDrainLayer: Layer.Layer<
  RunEventDrain,
  never,
  Stdio.Stdio | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  RunEventDrain,
  Effect.flatMap(
    Effect.all([Stdio.Stdio, FileSystem.FileSystem, Path.Path]),
    ([stdio, fs, path]) => drainFileOf(stdio, fs, path),
  ),
)

export const portLayer: Layer.Layer<RunEventStreamPortTag, never, never> = Layer.succeed(
  RunEventStreamPortTag,
  RunEventStreamPortTag.of({
    createRunEventStream: (resolved) => makeRunEventStream(resolved),
    emitNullScoreVerdict,
    emitMachineModeOutput,
  }),
)

const encodeUtf8 = (line: string) => new TextEncoder().encode(line)

const runToSink = <E>(stdio: Stdio.Stdio, lines: Stream.Stream<string, E>, toStdout: boolean) =>
  Boolean.match(toStdout, {
    onTrue: () => Stream.run(lines, stdio.stdout({ endOnDone: true })),
    onFalse: () => Stream.runDrain(lines),
  })

const drainToSinks = Effect.fn(SpanTaxonomy.Spans.runEventStreamDrainToSinks.name)(function*(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  stdio: Stdio.Stdio,
  fileName: string,
  toStdout: boolean,
  framed: Stream.Stream<string>,
) {
  yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
  yield* Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* fs.open(fileName, { flag: 'w' })
      const withFile = framed.pipe(
        Stream.tap((line) => handle.writeAll(encodeUtf8(line)).pipe(Effect.flatMap(() => handle.sync))),
      )
      yield* runToSink(stdio, withFile, toStdout).pipe(Effect.ignore)
    }),
  )
})

const drainStoredFile = Effect.fn(SpanTaxonomy.Spans.runEventStreamDrainStoredFile.name)(function*(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  stdio: Stdio.Stdio,
  fileNameRef: Ref.Ref<string>,
  toStdout: boolean,
  framed: Stream.Stream<string>,
) {
  const fileName = yield* Ref.get(fileNameRef)
  yield* drainToSinks(fs, path, stdio, fileName, toStdout, framed).pipe(Effect.orDie)
})

const drainFileOf = Effect.fn(SpanTaxonomy.Spans.runEventStreamDrainFile.name)(function*(
  stdio: Stdio.Stdio,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) {
  const fileNameRef = yield* Ref.make(RunEventDrain.DefaultProgressStreamFile)
  return RunEventDrain.of({
    drainFramed: (framed, toStdout) =>
      drainStoredFile(fs, path, stdio, fileNameRef, toStdout, framed).pipe(
        Effect.tapCause((cause) => Effect.logError('stryker.output.drain_file_failed', cause)),
        Effect.ignoreCause,
      ),
    setProgressStreamFile: (fileName: string) => Ref.set(fileNameRef, fileName),
  })
})

const drainOf = (stdio: Stdio.Stdio, framed: Stream.Stream<string>, toStdout: boolean) =>
  runToSink(stdio, framed, toStdout).pipe(
    Effect.withSpan(SpanTaxonomy.Spans.outputDrain.name),
    Effect.tapCause((cause) => Effect.logError('stryker.output.drain_failed', cause)),
    Effect.ignoreCause,
  )
