import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as S from 'effect/Schema'

import { WorkerOptionsWire } from './worker-options.schema.js'

export class WorkerOptions extends Context.Service<WorkerOptions, StrykerOptions>()(
  '@systemfsoftware/stryker-js-plugin-runtime/worker-options.service/WorkerOptions',
) {
  static readonly layer: Layer.Layer<
    WorkerOptions,
    Config.ConfigError | PlatformError | S.SchemaError,
    FileSystem.FileSystem | Path.Path
  > = Layer.effect(
    WorkerOptions,
    Effect.gen(function*() {
      const workerDir = yield* Config.String('STRYKER_WORKER_DIR')
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const raw = yield* fs.readFileString(path.join(workerDir, 'options.json'))
      return yield* S.decodeEffect(WorkerOptionsWire)(raw)
    }),
  )
}