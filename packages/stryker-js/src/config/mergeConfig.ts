import { mergeRecords } from '../Config.js'
import type { StrykerConfig } from './StrykerConfig.js'

export const mergeConfig = (defaults: StrykerConfig, overrides: StrykerConfig): StrykerConfig =>
  mergeRecords(defaults, overrides)
