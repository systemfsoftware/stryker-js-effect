import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import type * as Scope from 'effect/Scope'

import { fsVerdictStoreLayer } from '../drivers/fs-verdict-store.layer.js'
import { importS3VerdictStoreLayer } from '../drivers/s3-verdict-store.js'
import type { VerdictStoreUnavailable } from '../verdict-store/VerdictStore.schema.js'
import { VerdictStore, type VerdictStoreShape } from '../verdict-store/VerdictStore.service.js'

const fsLayerOf = (
  options: Options.FsVerdictStoreOptions,
  basePath: string,
): Layer.Layer<VerdictStore, VerdictStoreUnavailable, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(Effect.map(Path.Path, (path) => fsVerdictStoreLayer(path.resolve(basePath, options.directory))))

export interface VerdictStoreSelection {
  readonly options: Options.VerdictStoreOptions
  readonly basePath: string
}

const verdictStoreLayerOf = (
  { options, basePath }: VerdictStoreSelection,
): Layer.Layer<VerdictStore, VerdictStoreUnavailable, FileSystem.FileSystem | Path.Path> =>
  Match.value(options).pipe(
    Match.discriminatorsExhaustive('kind')({
      fs: (fs) => fsLayerOf(fs, basePath),
      s3: (s3) => Layer.unwrap(importS3VerdictStoreLayer({ options: s3, basePath })),
    }),
  )

export const verdictStoreOf = (
  selection: VerdictStoreSelection,
): Effect.Effect<VerdictStoreShape, VerdictStoreUnavailable, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.map(Layer.build(verdictStoreLayerOf(selection)), (built) => Context.get(built, VerdictStore))
