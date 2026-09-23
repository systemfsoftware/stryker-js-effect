import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import type * as Scope from 'effect/Scope'

import { close, type TSCompiler, make as makeTSCompiler } from './ts-compiler.handle.js'

const TypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TSCompilerResource')
export type TypeId = typeof TypeId

export interface TSCompilerResource extends Pipeable {
  readonly [TypeId]: TypeId
  readonly spec: StrykerOptions
  readonly scoped: Effect.Effect<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path>
  layer<Id>(service: Context.Key<Id, TSCompiler>): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>
}

export const scoped = (
  options: StrykerOptions,
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
  ): (options: StrykerOptions) => Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>
  <Id>(
    service: Context.Key<Id, TSCompiler>,
    options: StrykerOptions,
  ): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>
} = dual(
  (args) => args.length >= 2,
  <Id>(
    service: Context.Key<Id, TSCompiler>,
    options: StrykerOptions,
  ): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path> => Layer.effect(service)(scoped(options)),
)

export const make = (options: StrykerOptions): TSCompilerResource => {
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
