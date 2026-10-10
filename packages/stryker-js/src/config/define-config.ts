import type { Configuration } from '@systemfsoftware/stryker-js-contracts'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export type StrykerConfig = Options.PartialStrykerOptions

export type StrykerConfigFn = (env: Configuration.ConfigEnv) => StrykerConfig | Promise<StrykerConfig>

export type StrykerConfigExport = StrykerConfig | Promise<StrykerConfig> | StrykerConfigFn

export function defineConfig(config: StrykerConfig): StrykerConfig
export function defineConfig(config: Promise<StrykerConfig>): Promise<StrykerConfig>
export function defineConfig(config: StrykerConfigFn): StrykerConfigFn
export function defineConfig(config: StrykerConfigExport): StrykerConfigExport
export function defineConfig(config: StrykerConfigExport): StrykerConfigExport {
  return config
}
