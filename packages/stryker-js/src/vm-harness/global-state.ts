import type { HarnessApi } from './registry.js'

export const STATE_KEY = Symbol.for('@systemfsoftware/stryker-js/vm-runner')

export interface EffectVitestSurface {
  readonly it: unknown
}

export interface VmRunnerGlobalState {
  readonly api: HarnessApi
  readonly expect: unknown
  readonly vi: unknown
  readonly effectVitest: EffectVitestSurface | undefined
}

export const readGlobalState = (): VmRunnerGlobalState | undefined =>
  (globalThis as Record<symbol, VmRunnerGlobalState | undefined>)[STATE_KEY]

export const writeGlobalState = (state: VmRunnerGlobalState | undefined): void => {
  ;(globalThis as Record<symbol, VmRunnerGlobalState | undefined>)[STATE_KEY] = state
}
