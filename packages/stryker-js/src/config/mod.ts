import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export type PartialStrykerOptions = Options.PartialStrykerOptions
export type StrykerOptions = Options.StrykerOptions
export { StrykerConfig } from './stryker-config.schema.js'
export type {
  ConfigEnv,
  Immutable,
  ImmutablePrimitive,
  Primitive,
  StrykerConfigExport,
  StrykerConfigFn,
} from './stryker-config.schema.js'
