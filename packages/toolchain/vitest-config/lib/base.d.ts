import type { ViteUserConfig } from 'vitest/config'

declare const sharedConfig: ViteUserConfig
declare const isCI: boolean
declare const defineConfig: (config: ViteUserConfig) => Promise<ViteUserConfig>
declare const openTelemetry: { readonly enabled: boolean; readonly sdkPath: string }

export { defineConfig, isCI, openTelemetry, sharedConfig }
export type { ViteUserConfig }
