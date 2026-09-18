import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import type { OutputMode } from '../output-mode.js'

export type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'

export interface ConfigEnv {
  readonly command: 'run' | 'merge-reports'
  readonly isDryRun: boolean
  readonly mode: OutputMode
  readonly isCi: boolean
}

export type StrykerConfig = PartialStrykerOptions

export type StrykerConfigValue =
  | StrykerConfig
  | Promise<StrykerConfig>
  | ((env: ConfigEnv) => StrykerConfig | Promise<StrykerConfig>)
