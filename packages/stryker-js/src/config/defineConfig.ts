import type { StrykerConfigValue } from './StrykerConfig.js'

export const defineConfig = <const T extends StrykerConfigValue>(config: T): T => config
