import { Module } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

interface NodeModule {
  findPackageJSON(specifier: string, base: string): string | undefined
}

export const nodeModuleLayer: Layer.Layer<Module> = Layer.effect(
  Module,
  Effect.sync(() => {
    const nodeModule: NodeModule = process.getBuiltinModule('node:module')
    return {
      findPackageJSON: (specifier, base) => {
        try {
          return nodeModule.findPackageJSON(specifier, base)
        } catch {
          return undefined
        }
      },
    }
  }),
)
