import * as Context from 'effect/Context'

export interface VmScript {
  readonly runInContext: <A = unknown>(context: object) => A
}

export type VmRequire = <A = unknown>(specifier: string) => A

export interface VmModule {
  readonly createContext: (sandbox: object) => object
  readonly Script: new(code: string, options?: { readonly filename?: string }) => VmScript
}

export interface VmModuleBuiltin {
  readonly createRequire: (fileName: string | URL) => VmRequire
  readonly stripTypeScriptTypes: (
    source: string,
    options?: { readonly mode?: 'strip' | 'transform' },
  ) => string
}

export interface VmPlatform {
  readonly module: VmModuleBuiltin
  readonly vm: VmModule
}

export class VmRunner
  extends Context.Service<VmRunner, VmPlatform>()('@systemfsoftware/stryker-js/VmRunner.service/VmRunner')
{}
