import type { StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

type WorkerOptionsWire = S.Codec<StrykerOptions, string>

let wire: WorkerOptionsWire | undefined

const workerOptionsWire = (): WorkerOptionsWire => wire ??= S.fromJsonString(S.toCodecJson(StrykerOptionsSchema))

export const encodeWorkerOptions = (options: StrykerOptions): Effect.Effect<string> =>
  S.encodeEffect(workerOptionsWire())(options).pipe(Effect.orDie)

export const decodeWorkerOptions = (raw: string) => S.decodeUnknownEffect(workerOptionsWire())(raw)

export const readWorkerOptionsFromEnv = Effect.gen(function*() {
  const workerDir = process.env['STRYKER_WORKER_DIR'] ?? (yield* Effect.die(new Error('STRYKER_WORKER_DIR is not set')))
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const raw = yield* fs.readFileString(path.join(workerDir, 'options.json'))
  return yield* decodeWorkerOptions(raw)
})
