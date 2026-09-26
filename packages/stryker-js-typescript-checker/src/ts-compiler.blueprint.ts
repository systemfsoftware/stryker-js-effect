import { Blueprint } from '@systemfsoftware/effect-cell-types'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type * as Scope from 'effect/Scope'

import { close, make as makeTSCompiler, type TSCompiler } from './ts-compiler.handle.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSCompilerResource')
export type TypeId = typeof TypeId

const scopedOf: (
  spec: Options.StrykerOptions,
) => Effect.Effect<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path> = Effect.fn(
  'typescript-checker.compiler.scoped',
)(function*(
  spec: Options.StrykerOptions,
): Effect.fn.Return<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path> {
  const host = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const compiler = yield* makeTSCompiler(spec, { host, pathService })
  yield* Effect.addFinalizer(() => close(compiler))
  return compiler
})

const layerOf =
  (spec: Options.StrykerOptions) =>
  <Id>(service: Context.Key<Id, TSCompiler>): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path> =>
    Layer.effect(service)(scopedOf(spec))

const TSCompilerResource = Blueprint.make<Options.StrykerOptions>()(TypeId).steps({
  steps: {},
  targets: { layer: layerOf, scoped: scopedOf },
})

export type TSCompilerResource = Blueprint.Of<typeof TSCompilerResource>

export const make = (options: Options.StrykerOptions): TSCompilerResource => TSCompilerResource.of(options)
