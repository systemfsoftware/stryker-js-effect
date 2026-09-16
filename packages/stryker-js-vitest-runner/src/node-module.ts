import { Module, type ModuleRequire } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

interface NodeModule {
  createRequire(filename: string | URL): NodeRequire
  isBuiltin(moduleName: string): boolean
}

const EMPTY_PATHS: readonly string[] = []

const makeModuleRequire = (nodeModule: NodeModule, filename: string | URL): ModuleRequire => {
  const requireFrom: NodeRequire = nodeModule.createRequire(filename)
  const requireFn: ModuleRequire = (request: string): unknown => requireFrom(request)
  requireFn.resolve = (request, options) =>
    Option.match(Option.fromUndefinedOr(options), {
      onNone: () => requireFrom.resolve(request),
      onSome: (present) =>
        requireFrom.resolve(request, {
          paths: [...Option.getOrElse(Option.fromNullishOr(present.paths), () => EMPTY_PATHS)],
        }),
    })
  return requireFn
}

/**
 * The Node implementation of the {@link Module} port for a worker process:
 * every call routes through the runtime's own `node:module` via
 * `process.getBuiltinModule`, so the plugin's worker entry imports no host
 * builtin and resolves the wrapped tool from the project it runs in.
 */
export const nodeModuleLayer: Layer.Layer<Module> = Layer.effect(
  Module,
  Effect.sync(() => {
    const nodeModule: NodeModule = process.getBuiltinModule('node:module')
    return {
      createRequire: (filename) => makeModuleRequire(nodeModule, filename),
      isBuiltin: (moduleName) => nodeModule.isBuiltin(moduleName),
    }
  }),
)
