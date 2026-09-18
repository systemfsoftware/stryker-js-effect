export { defineConfig } from '@systemfsoftware/stryker-js/config'
import type { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export function createSharedConfig(overrides?: StrykerConfig): StrykerConfig

declare const sharedConfig: StrykerConfig

export { sharedConfig }
export type { StrykerConfig }
