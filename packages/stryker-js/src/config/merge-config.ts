import { mergeRecords } from '../run/load-config.cell.js'
import type { StrykerConfig } from './stryker-config.js'

export const mergeConfig = (defaults: StrykerConfig, overrides: StrykerConfig): StrykerConfig =>
  mergeRecords(defaults, overrides)
