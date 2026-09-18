import type { StrykerConfigValue } from './stryker-config.js'

export const defineConfig = <const T extends StrykerConfigValue>(config: T): T => config
