import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import type * as Scope from 'effect/Scope'

import { close, make as makeTSCompiler, type TSCompiler } from './ts-compiler.handle.js'

const TypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSCompilerResource')
export type TypeId = typeof TypeId

export interface TSCompilerResource extends Pipeable {
  readonly [TypeId]: TypeId
  readonly spec: Options.StrykerOptions
  readonly scoped: Effect.Effect<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path>
  layer<Id>(service: Context.Key<Id, TSCompiler>): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>
}

export const scoped = (
  options: Options.StrykerOptions,
): Effect.Effect<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const host = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const compiler = makeTSCompiler(options, { host, pathService })
    yield* Effect.addFinalizer(() => close(compiler).pipe(Effect.uninterruptible))
    return compiler
  })

export const layer: {
  <Id>(
    service: Context.Key<Id, TSCompiler>,
  ): (options: Options.StrykerOptions) => Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>
  <Id>(
    service: Context.Key<Id, TSCompiler>,
    options: Options.StrykerOptions,
  ): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>
} = dual(
  (args) => args.length >= 2,
  <Id>(
    service: Context.Key<Id, TSCompiler>,
    options: Options.StrykerOptions,
  ): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path> => Layer.effect(service)(scoped(options)),
)

export const make = (options: Options.StrykerOptions): TSCompilerResource => {
  const self: TSCompilerResource = {
    [TypeId]: TypeId,
    spec: options,
    ...Prototype,
    get scoped() {
      return scoped(options)
    },
    layer<Id>(service: Context.Key<Id, TSCompiler>): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path> {
      return layer(service, options)
    },
  }
  return self
}
