import type { ViteUserConfig } from 'vitest/config'

declare const sharedConfig: ViteUserConfig
declare const isCI: boolean
declare const defineConfig: (config: ViteUserConfig) => Promise<ViteUserConfig>

export { defineConfig, isCI, sharedConfig }
export type { ViteUserConfig }
