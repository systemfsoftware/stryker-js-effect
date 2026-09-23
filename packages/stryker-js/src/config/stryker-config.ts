import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import type { OutputMode } from '../output-mode.schema.js'

export type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'

export interface ConfigEnv {
  readonly command: 'run' | 'merge-reports'
  readonly isDryRun: boolean
  readonly mode: OutputMode
  readonly isCi: boolean
}

export type StrykerConfig = PartialStrykerOptions

export type StrykerConfigFn = (env: ConfigEnv) => StrykerConfig | Promise<StrykerConfig>

export type StrykerConfigExport = StrykerConfig | Promise<StrykerConfig> | StrykerConfigFn
