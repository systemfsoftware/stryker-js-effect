import type { StrykerConfig, StrykerConfigExport, StrykerConfigFn } from './stryker-config.js'

export function defineConfig(config: StrykerConfig): StrykerConfig
export function defineConfig(config: Promise<StrykerConfig>): Promise<StrykerConfig>
export function defineConfig(config: StrykerConfigFn): StrykerConfigFn
export function defineConfig(config: StrykerConfigExport): StrykerConfigExport
export function defineConfig(config: StrykerConfigExport): StrykerConfigExport {
  return config
}
