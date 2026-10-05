import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

export interface AtomicWritePorts {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
}

export const writeFileAtomic = Effect.fn(SpanTaxonomy.Spans.mutationReportingWriteAtomic.name)(function*(
  ports: AtomicWritePorts,
  file: string,
  content: string,
): Effect.fn.Return<void, PlatformError> {
  const directory = ports.path.dirname(file)
  yield* ports.fs.makeDirectory(directory, { recursive: true })
  const temp = yield* ports.fs.makeTempFile({
    directory,
    prefix: `${ports.path.basename(file)}.`,
    suffix: '.tmp',
  })
  yield* Effect.gen(function*() {
    yield* ports.fs.writeFileString(temp, content)
    yield* ports.fs.rename(temp, file)
  }).pipe(
    Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : ports.fs.remove(temp).pipe(Effect.ignore)),
  )
})
