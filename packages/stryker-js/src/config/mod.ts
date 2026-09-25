import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export type PartialStrykerOptions = Options.PartialStrykerOptions
export type StrykerOptions = Options.StrykerOptions

export { defineConfig } from './define-config.js'
export { mergeConfig } from './merge-config.js'

export type {
  ConfigEnv,
  Immutable,
  ImmutablePrimitive,
  Primitive,
  StrykerConfig,
  StrykerConfigExport,
  StrykerConfigFn,
} from './stryker-config.schema.js'
