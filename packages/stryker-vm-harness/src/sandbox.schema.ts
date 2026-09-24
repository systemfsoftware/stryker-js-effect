import type { HarnessApi } from './registry.schema.js'

export interface ResolveFnOutput {
  readonly url: string
  readonly format?: string | null | undefined
  readonly shortCircuit?: boolean | undefined
}

export interface ResolveContext {
  readonly parentURL?: string | undefined
  readonly conditions?: ReadonlyArray<string> | undefined
}

export type NextResolve = (specifier: string, context: ResolveContext) => ResolveFnOutput

export type ResolveHookSync = (
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
) => ResolveFnOutput

export interface LoadContext {
  readonly format?: string | null | undefined
  readonly conditions?: ReadonlyArray<string> | undefined
}

export interface LoadFnOutput {
  readonly format: string | null | undefined
  readonly source?: string | ArrayBufferLike | Uint8Array | undefined
  readonly shortCircuit?: boolean | undefined
}

export type NextLoad = (url: string, context: LoadContext) => LoadFnOutput

export type LoadHookSync = (url: string, context: LoadContext, nextLoad: NextLoad) => LoadFnOutput

type AnyDecoded<A = unknown> = A

export interface HarnessModuleBuiltin {
  registerHooks(hooks: AnyDecoded): { readonly deregister: () => void } | undefined
}

export interface ActivateSandboxCommand {
  readonly prefix: string
}

export interface EffectVitestSurface<A = unknown> {
  readonly it: A
}

export interface VmRunnerGlobalState {
  readonly api: HarnessApi
  readonly expect: object | undefined
  readonly vi: object | undefined
  readonly effectVitest: EffectVitestSurface | undefined
}
