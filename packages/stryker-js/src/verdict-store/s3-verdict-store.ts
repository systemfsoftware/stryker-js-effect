import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'

import { packageEntrypointOf } from '../plugin-loader.service.js'
import { importModule } from '../run/read-config-document.js'
import { VerdictStoreUnavailable } from './VerdictStore.schema.js'
import type { VerdictStore } from './VerdictStore.service.js'

const S3_PACKAGE = '@systemfsoftware/stryker-js-verdict-store-s3'

type S3StoreLayer = Layer.Layer<VerdictStore, VerdictStoreUnavailable>

type S3LayerFactory<A = unknown> = (options: Options.S3VerdictStoreOptions) => A

const isLayerFactory = (value: unknown): value is S3LayerFactory => typeof value === 'function'

const isStoreLayer = (value: unknown): value is S3StoreLayer => Layer.isLayer(value)

const refusedAt = (options: Options.S3VerdictStoreOptions) => (reason: string): VerdictStoreUnavailable =>
  VerdictStoreUnavailable.make({ store: `s3://${options.bucket}/${options.prefix}`, reason })

const layerExportOf = <A = unknown>(module: A): Option.Option<S3LayerFactory> =>
  Option.liftPredicate(Predicate.hasProperty(module, 'layer') ? module.layer : undefined, isLayerFactory)

const reasonOf = <A = unknown>(cause: A): string =>
  Predicate.isError(cause) ? cause.message : 'it threw a non-error value'

const storeLayerOf = (
  factory: S3LayerFactory,
  options: Options.S3VerdictStoreOptions,
): Effect.Effect<S3StoreLayer, VerdictStoreUnavailable> =>
  Effect.try({
    try: () => factory(options),
    catch: (cause) => refusedAt(options)(`${S3_PACKAGE} refused the options: ${reasonOf(cause)}`),
  }).pipe(
    Effect.flatMap((built) =>
      Effect.fromOption(
        Option.liftPredicate(built, isStoreLayer),
        () => refusedAt(options)(`the layer export of ${S3_PACKAGE} did not return a Layer`),
      )
    ),
  )

export interface S3VerdictStoreImport {
  readonly options: Options.S3VerdictStoreOptions
  readonly basePath: string
}

export const importS3VerdictStoreLayer = (
  { options, basePath }: S3VerdictStoreImport,
): Effect.Effect<S3StoreLayer, VerdictStoreUnavailable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const refused = refusedAt(options)
    const entry = yield* packageEntrypointOf(S3_PACKAGE, basePath).pipe(
      Effect.mapError((error) =>
        refused(`${S3_PACKAGE} is not installed (${error.message}); run "npm install --save-dev ${S3_PACKAGE}"`)
      ),
    )
    const module = yield* importModule(entry.href).pipe(
      Effect.mapError((error) => refused(`${S3_PACKAGE} could not be imported: ${error.message}`)),
    )
    const factory = yield* Effect.fromOption(
      layerExportOf(module),
      () => refused(`${S3_PACKAGE} does not export a layer function`),
    )
    return yield* storeLayerOf(factory, options)
  })
