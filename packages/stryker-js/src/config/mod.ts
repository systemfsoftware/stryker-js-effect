import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export type PartialStrykerOptions = Options.PartialStrykerOptions
export type StrykerOptions = Options.StrykerOptions

export { defineConfig, type StrykerConfig, type StrykerConfigExport, type StrykerConfigFn } from './define-config.js'
export { mergeConfig } from './merge-config.js'
